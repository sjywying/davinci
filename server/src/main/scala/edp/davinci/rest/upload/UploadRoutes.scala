/*-
 * <<
 * Davinci
 * ==
 * Copyright (C) 2016 - 2017 EDP
 * ==
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *      http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * >>
 */





package edp.davinci.rest.upload

import java.sql.Connection
import javax.ws.rs.Path

import akka.http.scaladsl.model.StatusCodes._
import akka.http.scaladsl.server.{Directives, Route}
import akka.stream.ActorMaterializer
import akka.stream.scaladsl.Framing
import akka.util.ByteString
import com.github.tototoshi.csv
import com.github.tototoshi.csv.{CSVFormat, CSVParser}
import edp.davinci.DavinciStarter
import edp.davinci.module.{BusinessModule, ConfigurationModule, PersistenceModule, RoutesModuleImpl}
import edp.davinci.persistence.entities.{PostUploadMeta, SourceConfig, UploadMeta}
import edp.davinci.rest.source.SourceService
import edp.davinci.rest.{ResponseJson, SessionClass}
import edp.davinci.util.json.JsonProtocol._
import edp.davinci.util.common.OpType.OpType
import edp.davinci.util.common.ResponseUtils.{currentTime, getHeader}
import edp.davinci.util._
import edp.davinci.util.common.DavinciConstants.requestTimeout
import edp.davinci.util.common.{AuthorizationProvider, LoadMode, OpType}
import edp.davinci.util.json.JsonUtils
import edp.davinci.util.sql.SqlUtils
import io.swagger.annotations._
import org.slf4j.LoggerFactory

import scala.collection.mutable
import scala.collection.mutable.ListBuffer
import scala.concurrent.Await
import scala.concurrent.duration.{FiniteDuration, SECONDS}
import scala.util.{Failure, Success}

@Api(value = "/uploads", consumes = "application/json", produces = "application/json")
@Path("/uploads")
class UploadRoutes(modules: ConfigurationModule with PersistenceModule with BusinessModule with RoutesModuleImpl)(implicit format: CSVFormat) extends Directives {
  private val logger = LoggerFactory.getLogger(this.getClass)
  private lazy val parser = new CSVParser(csv.defaultCSVFormat)
  implicit val materializer: ActorMaterializer = DavinciStarter.materializer
  lazy val routes: Route = saveUploadMeta ~ upload2Mysql


  @Path("/csv/{meta_id}")
  @ApiOperation(value = "upload csv", notes = "", nickname = "", httpMethod = "POST")
  @ApiImplicitParams(Array(
    new ApiImplicitParam(name = "meta_id ", value = "meta id", required = true, dataType = "integer", paramType = "path"),
    new ApiImplicitParam(name = "file ", value = "csv", required = true, dataType = "file", paramType = "formdata")
  ))
  @ApiResponses(Array(
    new ApiResponse(code = 200, message = "OK"),
    new ApiResponse(code = 401, message = "authorization error"),
    new ApiResponse(code = 404, message = "dashboard not found"),
    new ApiResponse(code = 400, message = "bad request")
  ))
  def upload2Mysql: Route = path("uploads" / "csv" / LongNumber) { metaId =>
    post {
      fileUpload("csv") { case (fileInfo, fileStream) =>
        val uploadClass = getUploadMeta(metaId)
        val sourceConf = getSourceConf(uploadClass.source_id)
        val listBuffer = new ListBuffer[List[String]]
        val schemaMap = mutable.HashMap.empty[String, (String, Int)]
        val batchSize = if (uploadClass.replace_mode == LoadMode.REPLACE) 500 else 1
        var conn: Connection = null
        try {
          conn = SqlUtils.getConnection(sourceConf.url, sourceConf.user, sourceConf.password)
          var rowCnt: Int = 0
          var schemaRow: List[String] = null
          val writeResult = fileStream.via(Framing.delimiter(ByteString("\r\n"), 1024000))
            .map(s => parser.parseLine(s.utf8String).get).runForeach(row => {
            rowCnt += 1
            if (rowCnt == 1) schemaRow = row
            logger.info(">>>>>>>>>>>>>>>>")
            if (rowCnt == 2) {
              for (i <- row.indices) schemaMap += schemaRow(i) -> (row(i), i)
              if (uploadClass.replace_mode == 1) SqlUtils.getCreateSql(schemaMap, uploadClass).foreach(conn.createStatement().execute)
            }
            if (rowCnt > 2)
              if (rowCnt % batchSize == 0) {
                listBuffer.append(row)
                write2DB(schemaMap, listBuffer, conn, uploadClass)
                listBuffer.clear()
              } else listBuffer.append(row)
          })
          onComplete(writeResult) {
            case Success(_) =>
              write2DB(schemaMap, listBuffer, conn, uploadClass)
              if (null != conn) conn.close()
              complete(OK, ResponseJson[String](getHeader(200, null), s"${fileInfo.fileName} upload successful"))
            case Failure(ex) =>
              if (null != conn) conn.close()
              logger.error("upload stream error", ex)
              complete(BadRequest, ResponseJson[String](getHeader(400, ex.getMessage, null), "write to db exception"))
          }
        } catch {
          case e: Throwable => logger.error("upload exception", e)
            complete(BadRequest, ResponseJson[String](getHeader(400, e.getMessage, null), ""))
        }
      }
    }
  }


  private def write2DB(schemaMap: mutable.HashMap[String, (String, Int)], listBuffer: ListBuffer[List[String]], conn: Connection, uploadClass: PostUploadMeta) = {
    def sqlProcess(opType: OpType): Unit = {
      val fieldNames = if (opType == OpType.INSERT) schemaMap.keySet.toList else uploadClass.primary_keys.get.split(",").toList
      val sql = if (opType == OpType.INSERT) SqlUtils.getInsertSql(fieldNames, uploadClass.table_name)
      else SqlUtils.getDeleteSql(uploadClass)
      val ps = conn.prepareStatement(sql)
      if (listBuffer.nonEmpty) {
        listBuffer.foreach(row => {
          for (i <- fieldNames.indices) {
            val accuracyIndex = schemaMap(fieldNames(i))._1.indexOf("(")
            val strType = if (accuracyIndex > -1) schemaMap(fieldNames(i))._1.substring(0, accuracyIndex) else schemaMap(fieldNames(i))._1
            val value = SqlUtils.s2dbValue(strType, row(schemaMap(fieldNames(i))._2).trim)
            val sqlType = SqlUtils.str2dbType(strType)
            if (null == value) ps.setNull(i + 1, sqlType)
            else ps.setObject(i + 1, value, sqlType)
          }
          ps.addBatch()
        })
        ps.executeBatch()
      }
    }

    try {
      sqlProcess(OpType.INSERT)
    } catch {
      case s: com.mysql.jdbc.exceptions.jdbc4.MySQLIntegrityConstraintViolationException =>
        logger.error("com.mysql.jdbc.exceptions ", s)
        if (uploadClass.replace_mode == LoadMode.MERGE) {
          sqlProcess(OpType.DELETE)
          sqlProcess(OpType.INSERT)
        }
      case e: Throwable => logger.error("ps execute ", e)
        throw e
    }
  }


  private def getSourceConf(sourceId: Long): SourceConfig = {
    Await.result(SourceService.getById(sourceId), new FiniteDuration(requestTimeout, SECONDS)) match {
      case Some(source) => JsonUtils.json2caseClass[SourceConfig](source.connection_url)
      case None => logger.error("$$$$$$$$$$$$$$$$$$$source not found " + sourceId)
        throw new Exception("source not found")
    }
  }

  private def getUploadMeta(metaId: Long): PostUploadMeta = {
    Await.result(UploadService.getUploadMeta(metaId), new FiniteDuration(requestTimeout, SECONDS)) match {
      case Some(meta) => meta
      case None => logger.error("$$$$$$$$$$$$$$$$$$$meta not found " + metaId)
        throw new Exception("meta not found")
    }
  }


  @Path("/meta")
  @ApiOperation(value = "upload meta", notes = "", nickname = "", httpMethod = "POST")
  @ApiImplicitParams(Array(
    new ApiImplicitParam(name = "upload_meta ", value = "upload meta entity", required = true, dataType = "edp.davinci.persistence.entities.PostUploadMeta", paramType = "body")))
  @ApiResponses(Array(
    new ApiResponse(code = 200, message = "OK"),
    new ApiResponse(code = 401, message = "authorization error"),
    new ApiResponse(code = 400, message = "bad request")
  ))
  def saveUploadMeta: Route = path("uploads" / "meta") {
    post {
      entity(as[PostUploadMeta]) { postMeta =>
        authenticateOAuth2Async[SessionClass](AuthorizationProvider.realm, AuthorizationProvider.authorize) {
          session =>
            if (session.admin) {
              val uploadMeta = UploadMeta(0, postMeta.source_id, postMeta.table_name, null, postMeta.primary_keys, postMeta.index_keys, postMeta.replace_mode, false, currentTime, session.userId)
              onComplete(modules.uploadMetaDal.insert(uploadMeta)) {
                case Success(meta) =>
                  complete(OK, ResponseJson[Long](getHeader(200, session), meta.id))
                case Failure(ex) =>
                  logger.error("save upload meta", ex)
                  complete(BadRequest, ResponseJson[String](getHeader(400, ex.getMessage, session), ""))
              }
            } else complete(Forbidden, ResponseJson[String](getHeader(403, session), ""))
        }
      }
    }
  }
}



