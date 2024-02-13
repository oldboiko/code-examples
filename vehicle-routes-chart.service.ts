/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Inject, Injectable } from '@angular/core'
import { TranslateService } from '@ngx-translate/core'

import { BehaviorSubject } from 'rxjs'

import {
  Chart,
  ChartConfiguration,
  ChartDataset,
  ChartType,
  ChartTypeRegistry,
  CoreInteractionOptions,
  DefaultDataPoint,
  PluginOptionsByType,
  registerables,
  ScaleOptionsByType,
  ScatterDataPoint,
} from 'chart.js'
import { each as EachChartjs } from 'chart.js/helpers'

import zoomPlugin from 'chartjs-plugin-zoom'
import dayjs from 'dayjs'
import { DeepPartial } from 'chart.js/types/utils'

import { dateFormats } from '@core/constants/dateFormats'
import { MapService } from '@app/modules/client/map/map.service'
import { SpeedPoint } from '@app/modules/client/map/map-details/shared/vehicle-routes/models/speed-point.model'
import { TemperaturePoint } from '@app/modules/client/map/map-details/shared/vehicle-routes/models/temperature-point.model'
import {
  ChartjsContext,
  InitOptions,
  LegendLine,
  ScalesOptions,
  TooltipPlugin,
  XScaleOptions,
  YScaleOptions,
} from '@app/modules/client/map/map-details/shared/vehicle-routes/models/chart-element.model'
import { GraphType } from '@app/modules/client/map/map-details/shared/vehicle-routes/models/graph-type.enum'
import { VehicleRoutesChartTooltipService } from '@app/modules/client/map/map-details/shared/vehicle-routes/vehicle-routes-charts-tooltip/vehicle-routes.chart-tooltip.service'
import { DrivingColorMap, getCustomSpeedLegend } from '@core/helpers/chart-js-helpers'
import { AuthService } from '@app/modules/auth/auth.service'
import { Coordinate } from '@shared/models/coordinate.model'
import { ThemeService } from '@shared/services/theme.service'
import { DeviceStatus } from '@app/shared/models/device.model'
import { MAP_ADAPTER } from '@app/modules/client/map/map-content/map-content.component'
import { MapAdapter } from '@app/modules/client/map/map-service/map-adapter'

Chart.register(...registerables)
Chart.register(zoomPlugin)

const tooltipPlugin = Chart.registry.getPlugin('tooltip') as TooltipPlugin
tooltipPlugin.positioners.cursor = (chartElements, coordinates) => coordinates

@Injectable()
export class VehicleRoutesChartService {
  readonly selectTime$ = new BehaviorSubject<string>(null)
  readonly minChartRange: number = 720000

  private readonly emptyValue = '-'
  private readonly _chartType: ChartType = 'line'

  get chartType(): ChartType {
    return this._chartType
  }

  get dateFormat(): string {
    return `${this.authService.getCurrentUserDateFormat() || dateFormats.date} HH:mm:ss`
  }

  private readonly chartEvents: string[] = [
    'mousemove',
    'mouseout',
    'click',
    'touchstart',
    'touchmove',
    'pointerup',
    'pointerdown',
    'mousedown',
    'mouseup',
  ]

  constructor(
    @Inject(MAP_ADAPTER) public mapAdapter: MapAdapter,
    private readonly translateService: TranslateService,
    private readonly mapService: MapService,
    private vehicleRoutesChartTooltipService: VehicleRoutesChartTooltipService,
    private readonly authService: AuthService,
    private readonly themeService: ThemeService,
  ) {}

  initChartOptions(
    { dateRange, isSpeed, isTemp, onZoom }: InitOptions,
    fetchData: () => void,
    routeOptimization: boolean,
  ): ChartConfiguration<ChartType>['options'] {
    const minTickTime: number = dateRange.startDate.tz().valueOf()
    const maxTickTime: number = dateRange.endDate.tz().valueOf()

    let accentColor = ''
    const theme$ = this.themeService.currentTheme$.subscribe((theme) => (accentColor = theme.accentColor))
    theme$.unsubscribe()

    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      events: this.chartEvents as any,
      responsive: true,
      animation: false,
      transitions: {
        zoom: {
          animation: {
            duration: 0,
          },
        },
      },
      elements: {
        point: {
          radius: 0,
        },
        line: {
          tension: 0,
        },
      },
      parsing: false,
      interaction: this.interactionOptions(),
      maintainAspectRatio: false,
      plugins: this.pluginsOptions(minTickTime, maxTickTime, isSpeed, fetchData, routeOptimization, accentColor, onZoom),
      scales: this.scalesOptions({ minTickTime, maxTickTime }, { isSpeed, isTemp }),
    }
  }

  bodyLines = ({ chart }: ChartjsContext): LegendLine[] => {
    if (!(chart?.data?.datasets && chart?.markerLine?.valueX)) {
      return []
    }

    const { datasets } = chart.data
    const { valueX } = chart.markerLine

    const selectTime = valueX
      ? dayjs(valueX)
          .tz()
          .format(this.dateFormat || dateFormats.dateTimeFull)
      : null
    this.selectTime$.next(selectTime)

    const moreThanCurrentTime = (item: ScatterDataPoint): boolean => item?.x > valueX

    const toLine = (dataset: ChartDataset<ChartType, DefaultDataPoint<'line'>>, index: number): LegendLine => {
      const { data } = dataset
      const pointIndex = data.findIndex(moreThanCurrentTime) - 1
      const point = data[pointIndex] as SpeedPoint | TemperaturePoint | Coordinate

      const isPointWithCoordinates = (point: SpeedPoint | Coordinate) => (<Coordinate>point).lat || (<SpeedPoint>point).coordinate.lat

      if (point) {
        if ('status' in point && isPointWithCoordinates(point)) {
          this.mapService.setSelectedChartPoint({
            speed: point.speed,
            status: point.status,
            ...('lat' in point
              ? {
                  lat: (<Coordinate>(<unknown>point)).lat,
                  lng: (<Coordinate>(<unknown>point)).lng,
                }
              : point.coordinate),
          })
        }
        return {
          label: this.getItemLabel(point as SpeedPoint | TemperaturePoint),
          color: this.getItemLegendColor(point as SpeedPoint | TemperaturePoint, dataset.borderColor || dataset?.backgroundColor),
          hidden: dataset.hidden,
          datasetIndex: index,
          value: (point as SpeedPoint | TemperaturePoint).y,
          type: 'status' in point ? GraphType.Speed : GraphType.Temperature,
          ...('status' in point && isPointWithCoordinates(point.coordinate) && { coordinate: point.coordinate }),
        }
      }

      return {
        label: dataset?.label,
        color: dataset?.borderColor?.toString() || dataset?.backgroundColor?.toString(),
        hidden: dataset.hidden,
        datasetIndex: index,
        value: this.emptyValue,
      }
    }

    const isVisibleLegend = (dataset: ChartDataset<ChartType, DefaultDataPoint<'line'>> & { invisibleInfo: boolean }, index: number) =>
      chart.isDatasetVisible(index) && !dataset.invisibleInfo && !!dataset

    const lines: LegendLine[] = datasets.filter(isVisibleLegend).map(toLine)

    return lines
  }

  private interactionOptions(): CoreInteractionOptions {
    return { mode: 'x', intersect: false, axis: 'x' }
  }

  private setTooltipData = (chart: Chart): void => {
    const legendLines = this.bodyLines({ chart })

    if (!legendLines.length) return

    if (legendLines[0]?.type === GraphType.Speed) {
      this.vehicleRoutesChartTooltipService.setSpeedLegendLines(legendLines)
    } else {
      this.vehicleRoutesChartTooltipService.setTempLegendLines(legendLines)
    }
    this.vehicleRoutesChartTooltipService.setTitle(this.selectTime$.getValue())
  }

  private clickLine = (chart: Chart): void => {
    const legendLines = this.bodyLines({ chart })
    if (!legendLines.length) return

    const speedLines = legendLines.filter((line) => line.type === 'speed')
    if (!speedLines.length) return

    this.mapAdapter.addPinnedMarker({
      speed: +speedLines[0].value,
      status: <DeviceStatus>speedLines[0].label,
      ...speedLines[0].coordinate,
    })
  }

  private getItemLabel(point: SpeedPoint | TemperaturePoint): string {
    return 'status' in point ? point.status : point.label
  }

  private getItemLegendColor(point: SpeedPoint | TemperaturePoint, datasetColor): string {
    return ('status' in point ? DrivingColorMap[point.status] : datasetColor) as string
  }

  updateTimeMinMax(chart: Chart): void {
    EachChartjs(Chart.instances, (instance) => {
      if (chart.id !== instance.id) {
        const currentTimeScale = chart.scales[chart.getDatasetMeta(0).xAxisID]
        const anotherTimeScale = instance.options.scales[instance.getDatasetMeta(0).xAxisID]
        anotherTimeScale.min = currentTimeScale.min
        anotherTimeScale.max = currentTimeScale.max
        instance.update()
      }
    })
  }

  private onPan = ({ chart }: ChartjsContext): boolean => {
    this.updateTimeMinMax(chart)
    return false
  }

  private onZoomStart = ({ event }: { event: Event }): void => {
    event.stopPropagation()
  }

  private pluginsOptions = (
    minTick: number,
    maxTick: number,
    isSpeed: boolean,
    fetchData: () => void,
    routeOptimization: boolean,
    accentColor: string,
    onZoom: ({ chart }: ChartjsContext) => void,
  ): PluginOptionsByType<ChartType> => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return {
      markerLine: {
        line: {
          color: 'rgba(116,59,238,0.65)',
          width: 2,
          dashPattern: [],
        },
        callbacks: {
          setTooltipData: this.setTooltipData,
          clickLine: this.clickLine,
        },
        sync: {
          enabled: true,
          group: 2,
        },
      },
      tooltip: {
        enabled: false,
      },
      htmlLegend: {
        enabled: true,
        ...(isSpeed && {
          customLegends: {
            items: getCustomSpeedLegend(),
            toggle: false,
          },
        }),
      },
      zoom: {
        zoom: {
          mode: 'x',
          wheel: { enabled: true },
          drag: {
            enabled: true,
            borderColor: accentColor,
            borderWidth: 1,
          },
          onZoom: onZoom,
          onZoomStart: this.onZoomStart,
          ...(isSpeed &&
            routeOptimization && {
              onZoomComplete: fetchData,
            }),
        },
        pan: {
          enabled: true,
          mode: 'x',
          modifierKey: 'shift',
          onPan: this.onPan,
          ...(isSpeed &&
            routeOptimization && {
              onPanComplete: fetchData,
            }),
        },
        limits: {
          x: { min: minTick, max: maxTick, minRange: this.minChartRange },
        },
      },
      legend: {
        display: false,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
  }

  private scalesOptions({ minTickTime, maxTickTime }: XScaleOptions, { isSpeed }: YScaleOptions): ScalesOptions {
    return {
      y: this.yAxes(isSpeed),
      x: this.xAxes(minTickTime, maxTickTime),
    }
  }

  private xAxes(
    minTickTime: number,
    maxTickTime: number,
  ): DeepPartial<ScaleOptionsByType<ChartTypeRegistry['line']['scales']> & { ticks: { count: number } }> {
    return {
      type: 'time',
      min: minTickTime,
      max: maxTickTime,
      time: {
        minUnit: 'second',
        displayFormats: {
          second: dateFormats.second,
          minute: dateFormats.fullTime,
          hour: dateFormats.fullTime,
          day: dateFormats.date,
          week: dateFormats.date,
          month: dateFormats.date,
          quarter: dateFormats.date,
          year: dateFormats.date,
        },
      },
    }
  }

  private transformLabelToKMH(label: string): string {
    return this.translateService.instant('ABBREVIATIONS.KM_H', { value: label }) as string
  }

  private yAxes(isSpeedChartEnabled: boolean): ScaleOptionsByType<ChartTypeRegistry['line']['scales']> {
    const yAxesSpeed = {
      position: 'left',
      type: 'linear',
      beginAtZero: true,
      suggestedMin: 0,
      min: 0,
      grid: {
        tickLength: 3,
        tickWidth: 1,
      },
      ticks: {
        stepSize: 10,
        precision: 1,
        callback: this.transformLabelToKMH.bind(this),
      },
    } as ScaleOptionsByType<ChartTypeRegistry['line']['scales']>

    const yAxesTemperature = {
      position: 'left',
      type: 'linear',
      grid: {
        tickLength: 6,
        tickWidth: 1,
      },
      ticks: {
        precision: 1,
        padding: 10,
        stepSize: 5,
        callback: this.transformLabelToCelsius.bind(this),
      },
    } as ScaleOptionsByType<ChartTypeRegistry['line']['scales']>

    return isSpeedChartEnabled ? yAxesSpeed : yAxesTemperature
  }

  private transformLabelToCelsius(label: string): string {
    return this.translateService.instant('ABBREVIATIONS.CELSIUS', { value: label }) as string
  }
}
