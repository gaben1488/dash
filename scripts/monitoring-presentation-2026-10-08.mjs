/** Reviewed native workbook presentation patch. Sheet IDs and schema coordinates are intentional.
 * Already applied to the rehearsal and live workbook; do not replay dimension groups blindly.
 * Changes copy and disclosure only; no financial inputs, master schema or stage conditional fills.
 */
/** Compact daily queue; apply once after inspecting existing dimension groups. */
export const reviewedQueuePresentation = [
  {
    "addDimensionGroup": {
      "range": {
        "sheetId": 2526400,
        "dimension": "COLUMNS",
        "startIndex": 1,
        "endIndex": 2
      }
    }
  },
  {
    "updateDimensionGroup": {
      "dimensionGroup": {
        "range": {
          "sheetId": 2526400,
          "dimension": "COLUMNS",
          "startIndex": 1,
          "endIndex": 2
        },
        "depth": 1,
        "collapsed": true
      },
      "fields": "collapsed"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526400,
        "dimension": "COLUMNS",
        "startIndex": 1,
        "endIndex": 2
      },
      "properties": {
        "hiddenByUser": true
      },
      "fields": "hiddenByUser"
    }
  },
  {
    "addDimensionGroup": {
      "range": {
        "sheetId": 2526400,
        "dimension": "COLUMNS",
        "startIndex": 4,
        "endIndex": 5
      }
    }
  },
  {
    "updateDimensionGroup": {
      "dimensionGroup": {
        "range": {
          "sheetId": 2526400,
          "dimension": "COLUMNS",
          "startIndex": 4,
          "endIndex": 5
        },
        "depth": 1,
        "collapsed": true
      },
      "fields": "collapsed"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526400,
        "dimension": "COLUMNS",
        "startIndex": 4,
        "endIndex": 5
      },
      "properties": {
        "hiddenByUser": true
      },
      "fields": "hiddenByUser"
    }
  },
  {
    "addDimensionGroup": {
      "range": {
        "sheetId": 2526400,
        "dimension": "COLUMNS",
        "startIndex": 8,
        "endIndex": 9
      }
    }
  },
  {
    "updateDimensionGroup": {
      "dimensionGroup": {
        "range": {
          "sheetId": 2526400,
          "dimension": "COLUMNS",
          "startIndex": 8,
          "endIndex": 9
        },
        "depth": 1,
        "collapsed": true
      },
      "fields": "collapsed"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526400,
        "dimension": "COLUMNS",
        "startIndex": 8,
        "endIndex": 9
      },
      "properties": {
        "hiddenByUser": true
      },
      "fields": "hiddenByUser"
    }
  },
  {
    "addDimensionGroup": {
      "range": {
        "sheetId": 2526400,
        "dimension": "COLUMNS",
        "startIndex": 10,
        "endIndex": 13
      }
    }
  },
  {
    "updateDimensionGroup": {
      "dimensionGroup": {
        "range": {
          "sheetId": 2526400,
          "dimension": "COLUMNS",
          "startIndex": 10,
          "endIndex": 13
        },
        "depth": 1,
        "collapsed": true
      },
      "fields": "collapsed"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526400,
        "dimension": "COLUMNS",
        "startIndex": 10,
        "endIndex": 13
      },
      "properties": {
        "hiddenByUser": true
      },
      "fields": "hiddenByUser"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526400,
        "dimension": "COLUMNS",
        "startIndex": 0,
        "endIndex": 1
      },
      "properties": {
        "pixelSize": 100
      },
      "fields": "pixelSize"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526400,
        "dimension": "COLUMNS",
        "startIndex": 2,
        "endIndex": 3
      },
      "properties": {
        "pixelSize": 190
      },
      "fields": "pixelSize"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526400,
        "dimension": "COLUMNS",
        "startIndex": 3,
        "endIndex": 4
      },
      "properties": {
        "pixelSize": 115
      },
      "fields": "pixelSize"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526400,
        "dimension": "COLUMNS",
        "startIndex": 5,
        "endIndex": 6
      },
      "properties": {
        "pixelSize": 170
      },
      "fields": "pixelSize"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526400,
        "dimension": "COLUMNS",
        "startIndex": 6,
        "endIndex": 7
      },
      "properties": {
        "pixelSize": 270
      },
      "fields": "pixelSize"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526400,
        "dimension": "COLUMNS",
        "startIndex": 7,
        "endIndex": 8
      },
      "properties": {
        "pixelSize": 150
      },
      "fields": "pixelSize"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526400,
        "dimension": "COLUMNS",
        "startIndex": 9,
        "endIndex": 10
      },
      "properties": {
        "pixelSize": 185
      },
      "fields": "pixelSize"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526400,
        "rowIndex": 0,
        "columnIndex": 0
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "formulaValue": "=\"В работе: \"&COUNTIF(D3:D1002;\"?*\")&\". Код открывает строку реестра. Дата — ориентир из источника, не назначенный срок. Проверки закрытых процедур: \"&COUNTIF(O3:O1002;\"?*\")&\" — справа.\""
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "repeatCell": {
      "range": {
        "sheetId": 2526400,
        "startRowIndex": 0,
        "endRowIndex": 1,
        "startColumnIndex": 0,
        "endColumnIndex": 13
      },
      "cell": {
        "userEnteredFormat": {
          "wrapStrategy": "WRAP",
          "textFormat": {
            "fontFamily": "Arial",
            "fontSize": 11,
            "bold": false
          }
        }
      },
      "fields": "userEnteredFormat.wrapStrategy,userEnteredFormat.textFormat"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526400,
        "dimension": "ROWS",
        "startIndex": 0,
        "endIndex": 1
      },
      "properties": {
        "pixelSize": 70
      },
      "fields": "pixelSize"
    }
  }
];

export const reviewedWorkbookPresentation = [
  {
    "updateCells": {
      "start": {
        "sheetId": 2526800,
        "rowIndex": 0,
        "columnIndex": 2
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "formulaValue": "=IFERROR(IF(OR(NOT(ISNUMBER(B220));B220<=0;COUNTIF(B157:B209;\"не рассчитано\")>0;NOT(ISNUMBER(I147));B224<>\"схема соответствует\";B225<>\"охват соответствует сетке\";NOT(AND(ISFORMULA(J210);ISFORMULA(I147);ISFORMULA(B152);ISFORMULA(B153);ISFORMULA(B220);ISFORMULA(I39);ISFORMULA(I51);ISFORMULA(I63);ISFORMULA(I75);ISFORMULA(I87);ISFORMULA(I99);ISFORMULA(I111);ISFORMULA(I123);ISFORMULA(I135))));\"Свод не рассчитан — проверьте знаменатель, правила, семьи и схему\";\"Требуют внимания · процедур: \"&B218&CHAR(10)&\"Экономия требует распределения / проверки: \"&TEXT(B152;\"#,##0.00\")&\" ₽\"&CHAR(10)&IF(OR(COUNTIF(E16:E25;\"<>сошлось\")>0;ROUND(D150;2)<>0;ROUND(D151;2)<>0;B215<>0);\"Есть несогласованность расчётов\";\"Арифметика согласована\")&CHAR(10)&\"Результатов внесено \"&C12&\", учтено \"&B216&\", требуют проверки даты \"&B217&IF(B217>0;\" (\"&C217&\")\";\"\")&\" · без даты итогов \"&B221);\"Свод не рассчитан — проверьте формулы и контроль\")"
              },
              "note": "Арифметическая согласованность, полнота сведений и подтверждение результата — разные проверки. Дата расчёта не означает дату обновления фактов."
            }
          ]
        }
      ],
      "fields": "userEnteredValue,note"
    }
  },
  {
    "unmergeCells": {
      "range": {
        "sheetId": 2526800,
        "startRowIndex": 0,
        "endRowIndex": 1,
        "startColumnIndex": 2,
        "endColumnIndex": 7
      }
    }
  },
  {
    "mergeCells": {
      "range": {
        "sheetId": 2526800,
        "startRowIndex": 0,
        "endRowIndex": 1,
        "startColumnIndex": 2,
        "endColumnIndex": 10
      },
      "mergeType": "MERGE_ALL"
    }
  },
  {
    "unmergeCells": {
      "range": {
        "sheetId": 2526800,
        "startRowIndex": 12,
        "endRowIndex": 13,
        "startColumnIndex": 0,
        "endColumnIndex": 7
      }
    }
  },
  {
    "mergeCells": {
      "range": {
        "sheetId": 2526800,
        "startRowIndex": 12,
        "endRowIndex": 13,
        "startColumnIndex": 0,
        "endColumnIndex": 10
      },
      "mergeType": "MERGE_ALL"
    }
  },
  {
    "deleteDimensionGroup": {
      "range": {
        "sheetId": 2526800,
        "dimension": "COLUMNS",
        "startIndex": 7,
        "endIndex": 18
      }
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526800,
        "dimension": "COLUMNS",
        "startIndex": 0,
        "endIndex": 18
      },
      "properties": {
        "hiddenByUser": false
      },
      "fields": "hiddenByUser"
    }
  },
  {
    "addDimensionGroup": {
      "range": {
        "sheetId": 2526800,
        "dimension": "COLUMNS",
        "startIndex": 3,
        "endIndex": 5
      }
    }
  },
  {
    "updateDimensionGroup": {
      "dimensionGroup": {
        "range": {
          "sheetId": 2526800,
          "dimension": "COLUMNS",
          "startIndex": 3,
          "endIndex": 5
        },
        "depth": 1,
        "collapsed": true
      },
      "fields": "collapsed"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526800,
        "dimension": "COLUMNS",
        "startIndex": 3,
        "endIndex": 5
      },
      "properties": {
        "hiddenByUser": true
      },
      "fields": "hiddenByUser"
    }
  },
  {
    "addDimensionGroup": {
      "range": {
        "sheetId": 2526800,
        "dimension": "COLUMNS",
        "startIndex": 7,
        "endIndex": 8
      }
    }
  },
  {
    "updateDimensionGroup": {
      "dimensionGroup": {
        "range": {
          "sheetId": 2526800,
          "dimension": "COLUMNS",
          "startIndex": 7,
          "endIndex": 8
        },
        "depth": 1,
        "collapsed": true
      },
      "fields": "collapsed"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526800,
        "dimension": "COLUMNS",
        "startIndex": 7,
        "endIndex": 8
      },
      "properties": {
        "hiddenByUser": true
      },
      "fields": "hiddenByUser"
    }
  },
  {
    "addDimensionGroup": {
      "range": {
        "sheetId": 2526800,
        "dimension": "COLUMNS",
        "startIndex": 10,
        "endIndex": 18
      }
    }
  },
  {
    "updateDimensionGroup": {
      "dimensionGroup": {
        "range": {
          "sheetId": 2526800,
          "dimension": "COLUMNS",
          "startIndex": 10,
          "endIndex": 18
        },
        "depth": 1,
        "collapsed": true
      },
      "fields": "collapsed"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526800,
        "dimension": "COLUMNS",
        "startIndex": 10,
        "endIndex": 18
      },
      "properties": {
        "hiddenByUser": true
      },
      "fields": "hiddenByUser"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526800,
        "dimension": "COLUMNS",
        "startIndex": 0,
        "endIndex": 1
      },
      "properties": {
        "pixelSize": 200
      },
      "fields": "pixelSize"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526800,
        "dimension": "COLUMNS",
        "startIndex": 1,
        "endIndex": 2
      },
      "properties": {
        "pixelSize": 85
      },
      "fields": "pixelSize"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526800,
        "dimension": "COLUMNS",
        "startIndex": 2,
        "endIndex": 3
      },
      "properties": {
        "pixelSize": 125
      },
      "fields": "pixelSize"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526800,
        "dimension": "COLUMNS",
        "startIndex": 5,
        "endIndex": 6
      },
      "properties": {
        "pixelSize": 90
      },
      "fields": "pixelSize"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526800,
        "dimension": "COLUMNS",
        "startIndex": 6,
        "endIndex": 7
      },
      "properties": {
        "pixelSize": 170
      },
      "fields": "pixelSize"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526800,
        "dimension": "COLUMNS",
        "startIndex": 8,
        "endIndex": 9
      },
      "properties": {
        "pixelSize": 170
      },
      "fields": "pixelSize"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526800,
        "dimension": "COLUMNS",
        "startIndex": 9,
        "endIndex": 10
      },
      "properties": {
        "pixelSize": 170
      },
      "fields": "pixelSize"
    }
  },
  {
    "updateDimensionProperties": {
      "range": {
        "sheetId": 2526800,
        "dimension": "ROWS",
        "startIndex": 0,
        "endIndex": 1
      },
      "properties": {
        "pixelSize": 124
      },
      "fields": "pixelSize"
    }
  },
  {
    "repeatCell": {
      "range": {
        "sheetId": 2526800,
        "startRowIndex": 0,
        "endRowIndex": 1,
        "startColumnIndex": 2,
        "endColumnIndex": 10
      },
      "cell": {
        "userEnteredFormat": {
          "wrapStrategy": "WRAP",
          "textFormat": {
            "fontFamily": "Arial",
            "fontSize": 12,
            "bold": false
          }
        }
      },
      "fields": "userEnteredFormat.wrapStrategy,userEnteredFormat.textFormat"
    }
  },
  {
    "updateConditionalFormatRule": {
      "sheetId": 2526800,
      "index": 0,
      "rule": {
        "ranges": [
          {
            "sheetId": 2526800,
            "startRowIndex": 0,
            "endRowIndex": 1,
            "startColumnIndex": 2,
            "endColumnIndex": 10
          }
        ],
        "booleanRule": {
          "condition": {
            "type": "CUSTOM_FORMULA",
            "values": [
              {
                "userEnteredValue": "=REGEXMATCH($C$1;\"Свод не рассчитан|Есть несогласованность\")"
              }
            ]
          },
          "format": {
            "backgroundColor": {
              "red": 1,
              "green": 0.8784314,
              "blue": 0.8784314
            },
            "backgroundColorStyle": {
              "rgbColor": {
                "red": 1,
                "green": 0.8784314,
                "blue": 0.8784314
              }
            }
          }
        }
      }
    }
  },
  {
    "updateConditionalFormatRule": {
      "sheetId": 2526800,
      "index": 1,
      "rule": {
        "ranges": [
          {
            "sheetId": 2526800,
            "startRowIndex": 0,
            "endRowIndex": 1,
            "startColumnIndex": 2,
            "endColumnIndex": 10
          }
        ],
        "booleanRule": {
          "condition": {
            "type": "CUSTOM_FORMULA",
            "values": [
              {
                "userEnteredValue": "=$B$218>0"
              }
            ]
          },
          "format": {
            "backgroundColor": {
              "red": 1,
              "green": 0.95686275,
              "blue": 0.81960785
            },
            "backgroundColorStyle": {
              "rgbColor": {
                "red": 1,
                "green": 0.95686275,
                "blue": 0.81960785
              }
            }
          }
        }
      }
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526800,
        "rowIndex": 1,
        "columnIndex": 0
      },
      "rows": [
        {
          "values": [
            {
              "note": "Управление, к которому отнесена основная процедура. Совместные процедуры между управлениями показаны отдельно."
            }
          ]
        }
      ],
      "fields": "note"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526800,
        "rowIndex": 1,
        "columnIndex": 1
      },
      "rows": [
        {
          "values": [
            {
              "note": "Количество основных процедур. Строки-доли участников не увеличивают количество."
            }
          ]
        }
      ],
      "fields": "note"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526800,
        "rowIndex": 1,
        "columnIndex": 2
      },
      "rows": [
        {
          "values": [
            {
              "note": "Количество процедур с внесённым результатом «Состоялась». Число учтённых на дату результатов показано в статусе сверху."
            }
          ]
        }
      ],
      "fields": "note"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526800,
        "rowIndex": 1,
        "columnIndex": 5
      },
      "rows": [
        {
          "values": [
            {
              "note": "Процедуры со стадиями «Заявка», «Опубликована» и «Нет результата». Внесённый будущий результат отдельно требует проверки даты."
            }
          ]
        }
      ],
      "fields": "note"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526800,
        "rowIndex": 1,
        "columnIndex": 6
      },
      "rows": [
        {
          "values": [
            {
              "note": "НМЦК текущего плана. Переоформленные процедуры исключены из текущего плана и показаны отдельно в подробностях."
            }
          ]
        }
      ],
      "fields": "note"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526800,
        "rowIndex": 1,
        "columnIndex": 8
      },
      "rows": [
        {
          "values": [
            {
              "note": "Цена по итогам, допущенным на дату расчёта. Это не сведения об оплате или исполнении контракта. Будущая и ошибочная дата исключают денежный факт; пустая дата учитывается с замечанием."
            }
          ]
        }
      ],
      "fields": "note"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526800,
        "rowIndex": 1,
        "columnIndex": 9
      },
      "rows": [
        {
          "values": [
            {
              "note": "Разница НМЦК и цены по учтённым итогам. Распределение этой экономии по бюджетам раскрывается справа кнопкой «+»."
            }
          ]
        }
      ],
      "fields": "note"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526800,
        "rowIndex": 1,
        "columnIndex": 10
      },
      "rows": [
        {
          "values": [
            {
              "note": "Отношение общей учтённой экономии к НМЦК учтённых результатов; не среднее процентов строк."
            }
          ]
        }
      ],
      "fields": "note"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526800,
        "rowIndex": 1,
        "columnIndex": 16
      },
      "rows": [
        {
          "values": [
            {
              "note": "Историческая НМЦК переоформленных процедур. Это не экономия и не перевод денежных средств."
            }
          ]
        }
      ],
      "fields": "note"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526400,
        "rowIndex": 0,
        "columnIndex": 0
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "Слева — действия по процедурам в работе; справа — проверки данных завершённых процедур. Нажмите «Открыть», чтобы перейти к строке реестра. Дата — ориентир по исходным сведениям, а не установленный срок исполнения. Если срока нет, он не назначается автоматически."
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526400,
        "rowIndex": 1,
        "columnIndex": 0
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "Дата ориентира"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526400,
        "rowIndex": 1,
        "columnIndex": 1
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "Дней к дате"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526403,
        "rowIndex": 2,
        "columnIndex": 6
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "Цена по итогам"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526403,
        "rowIndex": 2,
        "columnIndex": 8
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "Экономия · ФБ"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526403,
        "rowIndex": 2,
        "columnIndex": 9
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "Экономия · КБ"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526403,
        "rowIndex": 2,
        "columnIndex": 10
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "Экономия · МБ"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526403,
        "rowIndex": 2,
        "columnIndex": 15
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "Замечания"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526402,
        "rowIndex": 0,
        "columnIndex": 6
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "Цена по итогам"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526402,
        "rowIndex": 0,
        "columnIndex": 8
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "Экономия · ФБ"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526402,
        "rowIndex": 0,
        "columnIndex": 9
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "Экономия · КБ"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526402,
        "rowIndex": 0,
        "columnIndex": 10
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "Экономия · МБ"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526402,
        "rowIndex": 0,
        "columnIndex": 15
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "Замечания"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526402,
        "rowIndex": 0,
        "columnIndex": 14
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "Проверка сумм участников"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526401,
        "rowIndex": 0,
        "columnIndex": 8
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "Причина незавершения"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526401,
        "rowIndex": 0,
        "columnIndex": 9
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "Следующая процедура"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526401,
        "rowIndex": 0,
        "columnIndex": 11
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "Замечания"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 837564274,
        "rowIndex": 0,
        "columnIndex": 1
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "Группа"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 837564274,
        "rowIndex": 0,
        "columnIndex": 5
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "Прежнее сокращённое название"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 837564274,
        "rowIndex": 0,
        "columnIndex": 16
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "Полное название в округе"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 837564274,
        "rowIndex": 0,
        "columnIndex": 17
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "Сокращённое название в округе"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 837564274,
        "rowIndex": 0,
        "columnIndex": 3
      },
      "rows": [
        {
          "values": [
            {
              "note": "Полное наименование заказчика. Техническая подпись пока сохранена для совместимости с действующим Dash."
            }
          ]
        }
      ],
      "fields": "note"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 837564274,
        "rowIndex": 0,
        "columnIndex": 4
      },
      "rows": [
        {
          "values": [
            {
              "note": "Сокращённое наименование заказчика. Техническая подпись пока сохранена для совместимости с действующим Dash."
            }
          ]
        }
      ],
      "fields": "note"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 837564274,
        "rowIndex": 0,
        "columnIndex": 8
      },
      "rows": [
        {
          "values": [
            {
              "note": "Другие подтверждённые написания названия; разделяются точкой с запятой. Используются для сопоставления, а не для создания новых заказчиков."
            }
          ]
        }
      ],
      "fields": "note"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526800,
        "rowIndex": 166,
        "columnIndex": 0
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "11. Некорректный формат даты"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526800,
        "rowIndex": 176,
        "columnIndex": 0
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "21. Данные доли не соответствуют основной процедуре"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526800,
        "rowIndex": 181,
        "columnIndex": 0
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "formulaValue": "=HYPERLINK(\"#gid=2526300&fvid=1872624975\";\"27. Одному поставщику указаны разные ИНН\")"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526800,
        "rowIndex": 182,
        "columnIndex": 0
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "formulaValue": "=HYPERLINK(\"#gid=2526300&fvid=372600434\";\"28. Экономия не распределена по бюджетам\")"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526800,
        "rowIndex": 185,
        "columnIndex": 0
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "formulaValue": "=HYPERLINK(\"#gid=2526300&fvid=164464371\";\"31. Результат внесён до даты итогов\")"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  },
  {
    "updateCells": {
      "start": {
        "sheetId": 2526800,
        "rowIndex": 202,
        "columnIndex": 0
      },
      "rows": [
        {
          "values": [
            {
              "userEnteredValue": {
                "stringValue": "47. Лишние пробелы в названии заказчика или предмете"
              }
            }
          ]
        }
      ],
      "fields": "userEnteredValue"
    }
  }
];
