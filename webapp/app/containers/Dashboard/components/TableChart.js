/*
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

import React, { PureComponent } from 'react'
import {connect} from 'react-redux'
import PropTypes from 'prop-types'
import classnames from 'classnames'
import moment from 'moment'

import Table from 'antd/lib/table'
import Select from 'antd/lib/select'
import Message from 'antd/lib/message'
const Option = Select.Option
import SearchFilterDropdown from '../../../components/SearchFilterDropdown/index'
import NumberFilterDropdown from '../../../components/NumberFilterDropdown/index'
import DateFilterDropdown from '../../../components/DateFilterDropdown/index'

import { COLUMN_WIDTH, DEFAULT_TABLE_PAGE, DEFAULT_TABLE_PAGE_SIZE, SQL_NUMBER_TYPES, SQL_DATE_TYPES } from '../../../globalConstants'
import {updateMark} from '../actions'
import styles from '../Dashboard.less'

export class TableChart extends PureComponent {
  constructor (props) {
    super(props)
    this.state = {
      data: {
        keys: props.data.keys ? props.data.keys.slice() : [],
        types: props.data.types ? props.data.types.slice() : [],
        dataSource: props.data.dataSource ? props.data.dataSource.slice() : []
      },
      sortedInfo: {},
      filterDropdownVisibles: {},
      filterValues: {},
      pagination: {
        pageSize: DEFAULT_TABLE_PAGE_SIZE,
        current: DEFAULT_TABLE_PAGE,
        showSizeChanger: true,
        pageSizeOptions: ['10', '20', '30', '40', '50', '100']
      }
    }
  }

  componentWillMount () {
    const { data, chartParams } = this.props
    const { filterValues } = this.state
    const { enumerationColumns } = chartParams

    if (data.keys && data.keys.length && !Object.keys(filterValues).length) {
      this.state.filterValues = this.initialFilterValues(data.keys, enumerationColumns)
    }
  }

  componentWillUpdate (nextProps) {
    const ec = this.props.chartParams.enumerationColumns
    const nextEC = nextProps.chartParams.enumerationColumns

    if (this.props.data !== nextProps.data) {
      this.state.data = {
        keys: nextProps.data.keys ? nextProps.data.keys.slice() : [],
        types: nextProps.data.types ? nextProps.data.types.slice() : [],
        dataSource: nextProps.data.dataSource ? nextProps.data.dataSource.slice() : []
      }
      this.state.filterValues = {}
    }

    if (nextProps.data.keys &&
        nextProps.data.keys.length &&
        !Object.keys(this.state.filterValues).length) {
      this.state.filterValues = this.initialFilterValues(nextProps.data.keys, ec)
    }

    if (nextEC && nextEC !== ec) {
      nextEC.forEach(k => {
        this.state.filterValues[k] = []
      })
    }
  }

  initialFilterValues = (keys, enumColumns) => {
    if (enumColumns) {
      return keys.reduce((rdc, k) => {
        if (enumColumns.indexOf(k) >= 0) {
          rdc[k] = []
        } else {
          rdc[k] = ['', '']
        }
        return rdc
      }, {})
    } else {
      return keys.reduce((rdc, k) => {
        rdc[k] = ['', '']
        return rdc
      }, {})
    }
  }

  handleTableChange = (pagination, filters, sorter) => {
    this.setState({
      pagination,
      sortedInfo: sorter
    }, () => {
      this.onLoadData()
    })
  }

  onSearchInputChange = (columnName) => (e) => {
    const filterValues = this.state.filterValues
    this.setState({
      filterValues: Object.assign({}, filterValues, {
        [columnName]: [e.target.value]
      })
    })
  }

  onNumberInputChange = (columnName) => (newValue) => {
    const filterValues = this.state.filterValues

    this.setState({
      filterValues: Object.assign({}, filterValues, {
        [columnName]: [
          isNaN(newValue[0]) ? filterValues[columnName][0] : newValue[0],
          isNaN(newValue[1]) ? filterValues[columnName][1] : newValue[1]
        ]
      })
    })
  }

  onRangePickerChange = (columnName) => (dates, dateStrings) => {
    const filterValues = this.state.filterValues
    this.state.filterValues = Object.assign({}, filterValues, {
      [columnName]: [dateStrings[0], dateStrings[1]]
    })
    this.onLoadData()
  }

  onLoadData = () => {
    const { data } = this.props
    const { filterValues } = this.state

    const { keys, types, dataSource } = data

    let filteredSource = dataSource.slice()

    Object.keys(filterValues).forEach(fkey => {
      const filterValue = filterValues[fkey]

      const keyIndex = keys.findIndex(k => k === fkey)
      const columnType = types[keyIndex]

      if (SQL_NUMBER_TYPES.indexOf(columnType) >= 0) {
        if (filterValue[0]) {
          filteredSource = filteredSource.filter(s => s[fkey] >= Number(filterValue[0]))
        }
        if (filterValue[1]) {
          filteredSource = filteredSource.filter(s => s[fkey] <= Number(filterValue[1]))
        }
      } else if (SQL_DATE_TYPES.indexOf(columnType) >= 0) {
        if (filterValue[0]) {
          filteredSource = filteredSource.filter(s => moment(s[fkey]) >= moment(filterValue[0]))
        }
        if (filterValue[1]) {
          filteredSource = filteredSource.filter(s => moment(s[fkey]) <= moment(filterValue[1]))
        }
      } else {
        if (filterValue[0]) {
          filteredSource = filteredSource.filter(s => s[fkey].includes(filterValue[0]))
        }
      }
    })

    this.setState({
      data: Object.assign({}, this.state.data, {
        dataSource: filteredSource
      })
    })
  }

  rowClick = (record, index, event) => {
    let target = event.target
    let targetName = target.tagName
    let targetClassName = target.classList[0]
    let re = /select/g

    if (targetName === 'DIV' && re.test(targetClassName)) {
      event.stopPropagation()
      return
    }

    const { id, onCheckInteract, onDoInteract } = this.props
    const { data } = this.state

    if (onCheckInteract && onDoInteract) {
      const linkagers = onCheckInteract(Number(id))

      if (Object.keys(linkagers).length) {
        data.dataSource.forEach(ds => {
          if (ds.antDesignTableId === record.antDesignTableId) {
            onDoInteract(Number(id), linkagers, record.antDesignTableId)
          }
        })

        this.setState({
          data: Object.assign({}, data)
        })
      }
    }
  }

  rowClassFilter = (record, index) =>
    this.props.interactId === record.antDesignTableId ? styles.selectedRow : ''

  markOptions = (value, record, updateVar) => {
    const {onUpdateMark, currentBizlogicId} = this.props
    let params = Object.assign({}, updateVar)
    for (let attr in params) {
      if (params[attr] === '标注器') {
        params[attr] = value
      } else {
        params[attr] = record[updateVar[attr]]
      }
    }
    let paramsArr = Object.keys(params).map(param => ({'k': param, 'v': params[param]}))
    onUpdateMark(currentBizlogicId, paramsArr,
        result => {
          Message.info(result)
        }, err => {
          Message.error(err)
        })
  }

  render () {
    const {
      loading,
      chartParams,
      updateParams,
      updateConfig,
      className,
      filterable,
      sortable,
      width,
      height
    } = this.props
    const {
      data,
      filterDropdownVisibles,
      filterValues,
      pagination
    } = this.state

    const dataSource = data.dataSource || []
    const dataKeys = data.keys || []
    const dataTypes = data.types || []
    const enumerationColumns = chartParams.enumerationColumns || []
    const dimensionColumns = chartParams.dimensionColumns || []
    const metricColumns = chartParams.metricColumns || []

    let enums = {}
    let columnKeys = null
    let columnTypes = null

    if (enumerationColumns.length) {
      enums = enumerationColumns.reduce((rlt, ec) => {
        rlt[ec] = {}
        return rlt
      }, {})

      dataSource.forEach(ds => {
        enumerationColumns.forEach(enumColumn => {
          if (!enums[enumColumn][ds[enumColumn]]) {
            enums[enumColumn][ds[enumColumn]] = 1
          }
        })
      })
    }

    if (dimensionColumns.length || metricColumns.length) {
      columnKeys = [].concat(dimensionColumns).concat(metricColumns)
      columnTypes = dimensionColumns.map(dc => dataTypes[dataKeys.indexOf(dc)])
        .concat(metricColumns.map(mc => dataTypes[dataKeys.indexOf(mc)]))
    } else {
      columnKeys = dataKeys
      columnTypes = dataTypes
    }

    const columns = columnKeys
      .filter(k => {
        if (dataSource.length) {
          return typeof dataSource[0][k] !== 'object'
        } else {
          return true
        }
      })
      .map((k, index) => {
        let filterDropdown = ''
        let filters = null

        const columnType = columnTypes[index]

        if (filterable) {
          if (enums[k]) {
            filters = {
              filters: Object.keys(enums[k]).map(en => ({ text: en, value: en })),
              onFilter: (value, record) => record[k] === value
            }
          } else {
            const filterValue = filterValues[k] || []

            if (SQL_NUMBER_TYPES.indexOf(columnType) >= 0) {
              filterDropdown = (
                <NumberFilterDropdown
                  value={filterValue}
                  onChange={this.onNumberInputChange(k)}
                  onSearch={this.onLoadData}
                />
              )
            } else if (SQL_DATE_TYPES.indexOf(columnType) >= 0) {
              filterDropdown = (
                <DateFilterDropdown
                  value={filterValue}
                  onChange={this.onRangePickerChange(k)}
                />
              )
            } else {
              filterDropdown = (
                <SearchFilterDropdown
                  placeholder={k}
                  value={filterValue[0]}
                  onChange={this.onSearchInputChange(k)}
                  onSearch={this.onLoadData}
                />
              )
            }

            filters = {
              filterDropdown: filterDropdown,
              filterDropdownVisible: filterDropdownVisibles[k] === undefined ? false : filterDropdownVisibles[k],
              onFilterDropdownVisibleChange: visible => {
                this.setState({
                  filterDropdownVisibles: Object.assign({}, filterDropdownVisibles, {
                    [k]: visible
                  })
                })
              }
            }
          }
        }

        let sorters = null

        if (sortable) {
          sorters = {
            sorter: (a, b) => {
              if (SQL_NUMBER_TYPES.indexOf(columnType) >= 0) {
                return Number(a[k]) - Number(b[k])
              } else {
                return a[k].trim() > b[k].trim() ? 1 : -1
              }
            }
          }
        }

        const dimensionClass = classnames({
          [styles.dimension]: dimensionColumns.length && dimensionColumns.indexOf(k) === dimensionColumns.length - 1
        })

        let plainColumn = {
          title: k.toUpperCase(),
          dataIndex: k,
          key: k,
          width: COLUMN_WIDTH,
          className: dimensionClass
        }

        return Object.assign(plainColumn, filters, sorters)
      })
    if (updateParams && updateParams.length) {
      columns.push(
        {
          title: '标注',
          dataIndex: 'mark',
          width: 140,
          render: (text, record) => (
            <Select style={{ width: 120 }} onChange={(event) => this.markOptions(event, record, updateConfig)}>
              {
                updateParams.map(up => <Option key={up.id} value={up.value}>{up.text}</Option>)
              }
            </Select>
          )
        }
      )
    }
    const predictColumnsWidth = columnKeys.length * COLUMN_WIDTH
    const tableWidthObj = predictColumnsWidth > width
      ? { x: predictColumnsWidth }
      : null
    const tableSize = Object.assign({}, tableWidthObj, { y: height })

    return (
      <Table
        className={className}
        rowKey="antDesignTableId"
        dataSource={dataSource}
        columns={columns}
        pagination={pagination}
        loading={loading}
        scroll={tableSize}
        onChange={this.handleTableChange}
        onRowClick={this.rowClick}
        rowClassName={this.rowClassFilter}
        bordered
      />
    )
  }
}

TableChart.propTypes = {
  id: PropTypes.string,
  data: PropTypes.object,
  loading: PropTypes.bool,
  chartParams: PropTypes.object,
  updateConfig: PropTypes.any,
  updateParams: PropTypes.array,
  className: PropTypes.string,
  filterable: PropTypes.bool,
  sortable: PropTypes.bool,
  width: PropTypes.number,
  height: PropTypes.number,
  interactId: PropTypes.string,
  onCheckInteract: PropTypes.func,
  onDoInteract: PropTypes.func,
  onUpdateMark: PropTypes.func,
  currentBizlogicId: PropTypes.oneOfType([
    PropTypes.bool,
    PropTypes.number
  ])
}

TableChart.defaultProps = {
  chartParams: {},
  filterable: true,
  sortable: true
}

export function mapDispatchToProps (dispatch) {
  return {
    onUpdateMark: (id, params, resolve, reject) => dispatch(updateMark(id, params, resolve, reject))
  }
}

export default connect(null, mapDispatchToProps)(TableChart)
