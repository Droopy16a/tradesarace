import { useEffect, useId, useRef, useState } from 'react';
import { LineChart } from '@mui/x-charts/LineChart';

function Chart({
  width = 800,
  height = 500,
  data = [],
  positions = [],
  timeStampRequest = 'h',
  setTimeStampRequest = () => {},
}) {
  const chartWrapperRef = useRef(null);
  const chartTerminalRef = useRef(null);
  const [chartWidth, setChartWidth] = useState(width);
  const [chartHeight, setChartHeight] = useState(height);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isZooming, setIsZooming] = useState(false);
  const [chartType, setChartType] = useState('line');
  const pipeClipId = useId().replace(/:/g, '');

  useEffect(() => {
    function updateChartSize() {
      const containerWidth = chartWrapperRef.current?.clientWidth || width;
      const viewportWidth = window.innerWidth;
      const isChartFullscreen = document.fullscreenElement === chartTerminalRef.current;
      const fullscreenHeight = Math.max(window.innerHeight - 140, 280);
      const nextHeight = isChartFullscreen
        ? fullscreenHeight
        : viewportWidth < 480
          ? 250
          : viewportWidth < 768
            ? 300
            : height;

      setChartWidth(Math.max(Math.floor(containerWidth), 280));
      setChartHeight(nextHeight);
    }

    updateChartSize();
    window.addEventListener('resize', updateChartSize);

    let resizeObserver;
    if (typeof ResizeObserver !== 'undefined' && chartWrapperRef.current) {
      resizeObserver = new ResizeObserver(updateChartSize);
      resizeObserver.observe(chartWrapperRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateChartSize);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [width, height]);

  useEffect(() => {
    function handleFullscreenChange() {
      const activeFullscreen = document.fullscreenElement === chartTerminalRef.current;
      setIsFullscreen(activeFullscreen);
      const containerWidth = chartWrapperRef.current?.clientWidth || width;
      const viewportWidth = window.innerWidth;
      const fullscreenHeight = Math.max(window.innerHeight - 140, 280);
      const nextHeight = activeFullscreen
        ? fullscreenHeight
        : viewportWidth < 480
          ? 250
          : viewportWidth < 768
            ? 300
            : height;
      setChartWidth(Math.max(Math.floor(containerWidth), 280));
      setChartHeight(nextHeight);
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [height, width]);

  if (!data || data.length === 0) return null;

  const yValues = data.map((point) => point.y);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const range = Math.max(maxY - minY, 1);
  const padding = range * 0.08;

  const latest = data[data.length - 1];
  const previous = data[data.length - 2] || latest;
  const isUp = (latest?.y || 0) >= (previous?.y || 0);

  const open = Number(data[0]?.y || 0);
  const close = Number(latest?.y || 0);
  const high = maxY;
  const low = minY;
  const change = open ? ((close - open) / open) * 100 : 0;
  const chartMargin = { top: 16, right: 72, bottom: 22, left: 20 };
  const axisMin = minY - padding;
  const axisMax = maxY + padding;
  const axisRange = Math.max(axisMax - axisMin, 1);
  const visiblePositions = positions
    .slice(-8)
    .map((position) => {
      const price = Number(position.executionPrice || 0);
      const clampedRatio = Math.min(Math.max((price - axisMin) / axisRange, 0), 1);
      return {
        ...position,
        price,
        topPercent: (1 - clampedRatio) * 100,
      };
    });

  const plotWidth = Math.max(chartWidth - chartMargin.left - chartMargin.right, 1);
  const plotHeight = Math.max(chartHeight - chartMargin.top - chartMargin.bottom, 1);
  const minTime = data[0]?.x?.getTime?.() || 0;
  const maxTime = data[data.length - 1]?.x?.getTime?.() || minTime + 1;
  const timeRange = Math.max(maxTime - minTime, 1);
  const tickHalfWidth = Math.max(Math.min(plotWidth / Math.max(data.length * 3, 1), 6), 2);
  const leftPadding = tickHalfWidth + 2;
  const rightPadding = tickHalfWidth + 56;
  const xDrawableWidth = Math.max(plotWidth - leftPadding - rightPadding, 1);

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  const pipeBars = data.map((point, index) => {
    const prev = data[index - 1]?.y ?? point.y;
    const next = data[index + 1]?.y ?? point.y;
    const openValue = Number(prev);
    const closeValue = Number(point.y);
    const highValue = Math.max(openValue, closeValue, Number(next));
    const lowValue = Math.min(openValue, closeValue, Number(next));
    const timestamp = point.x.getTime();

    const x = leftPadding + ((timestamp - minTime) / timeRange) * xDrawableWidth;
    const yOpen = clamp(((axisMax - openValue) / axisRange) * plotHeight, 0, plotHeight);
    const yClose = clamp(((axisMax - closeValue) / axisRange) * plotHeight, 0, plotHeight);
    const yHigh = clamp(((axisMax - highValue) / axisRange) * plotHeight, 0, plotHeight);
    const yLow = clamp(((axisMax - lowValue) / axisRange) * plotHeight, 0, plotHeight);
    const bullish = closeValue >= openValue;

    return {
      key: `${timestamp}-${index}`,
      x,
      yOpen,
      yClose,
      yHigh,
      yLow,
      bullish,
    };
  });

  function formatPrice(value, digits = 2) {
    return Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  async function toggleFullscreen() {
    if (!chartTerminalRef.current) return;

    setIsZooming(true);
    setTimeout(() => setIsZooming(false), 260);

    try {
      if (document.fullscreenElement === chartTerminalRef.current) {
        await document.exitFullscreen();
      } else {
        await chartTerminalRef.current.requestFullscreen();
      }
    } catch {
      // Ignore fullscreen errors (unsupported browser, denied permission, etc.)
    }
  }

  return (
    <div
      className={`chart-terminal ${isFullscreen ? 'is-fullscreen' : ''} ${isZooming ? 'is-zooming' : ''}`}
      ref={chartTerminalRef}
    >
      <div className="chart-toolbar">
        <div className="chart-tools">
          <button
            type="button"
            className={chartType === 'line' ? 'active' : ''}
            onClick={() => setChartType('line')}
          >
            Line
          </button>
          <button
            type="button"
            className={chartType === 'pipe' ? 'active' : ''}
            onClick={() => setChartType('pipe')}
          >
            Pipe
          </button>
        </div>
        <div className="chart-timeframes">
          <button
            type="button"
            className={timeStampRequest === 'h' ? 'active' : ''}
            onClick={() => setTimeStampRequest('h')}
          >
            1h
          </button>
          <button
            type="button"
            className={timeStampRequest === 'd' ? 'active' : ''}
            onClick={() => setTimeStampRequest('d')}
          >
            24h
          </button>
          <button
            type="button"
            className={timeStampRequest === 'w' ? 'active' : ''}
            onClick={() => setTimeStampRequest('w')}
          >
            1w
          </button>
          <button
            type="button"
            className={timeStampRequest === 'm' ? 'active' : ''}
            onClick={() => setTimeStampRequest('m')}
          >
            1m
          </button>
          <button
            type="button"
            className={timeStampRequest === 'y' ? 'active' : ''}
            onClick={() => setTimeStampRequest('y')}
          >
            1y
          </button>
        </div>
      </div>

      <div className="chart-ohlc">
        <span>O {formatPrice(open)}</span>
        <span>H {formatPrice(high)}</span>
        <span>L {formatPrice(low)}</span>
        <span>C {formatPrice(close)}</span>
        <strong className={change >= 0 ? 'up' : 'down'}>
          {change >= 0 ? '+' : ''}
          {formatPrice(change, 2)}%
        </strong>
      </div>

      <div className="chart-wrapper" ref={chartWrapperRef}>
        <LineChart
          width={chartWidth}
          height={chartHeight}
          dataset={data}
          margin={chartMargin}
          grid={{ horizontal: true, vertical: true }}
          xAxis={[
            {
              dataKey: 'x',
              scaleType: 'time',
              valueFormatter: (value) =>
                value.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit' }),
            },
          ]}
          yAxis={[
            {
              position: 'right',
              min: axisMin,
              max: axisMax,
              valueFormatter: (value) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
            },
          ]}
          series={[
            {
              dataKey: 'y',
              curve: 'linear',
              color: chartType === 'line' ? (isUp ? '#2dd4a3' : '#ff6a75') : 'rgba(0,0,0,0)',
              showMark: false,
              valueFormatter: (value) =>
                `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              area: chartType === 'line',
              connectNulls: true,
            },
          ]}
          sx={{
            '& .MuiChartsSurface-root': { backgroundColor: '#090f1d' },
            '& .MuiLineElement-root': {
              stroke: chartType === 'line' ? (isUp ? '#2dd4a3' : '#ff6a75') : 'rgba(0,0,0,0)',
              strokeWidth: chartType === 'line' ? 2.3 : 0,
            },
            '& .MuiAreaElement-root': {
              fill: chartType === 'line'
                ? (isUp ? 'rgba(45, 212, 163, 0.13)' : 'rgba(255, 106, 117, 0.13)')
                : 'rgba(0,0,0,0)',
            },
            '& .MuiChartsGrid-line': {
              stroke: 'rgba(126, 147, 190, 0.18)',
              strokeDasharray: '5 4',
            },
            '& .MuiChartsAxis-line': { stroke: 'rgba(126, 147, 190, 0.3)' },
            '& .MuiChartsAxis-tick': { stroke: 'rgba(126, 147, 190, 0.3)' },
            '& .MuiChartsAxis-tickLabel': {
              fill: '#8f9abc',
              fontSize: 11,
              fontFamily: 'Space Grotesk, sans-serif',
            },
          }}
          slotProps={{ legend: { hidden: true } }}
        />

        {chartType === 'pipe' && (
          <svg
            className="chart-pipe-overlay"
            width={plotWidth}
            height={plotHeight}
            viewBox={`0 0 ${plotWidth} ${plotHeight}`}
            style={{
              top: `${chartMargin.top}px`,
              left: `${chartMargin.left}px`,
            }}
          >
            <defs>
              <clipPath id={pipeClipId}>
                <rect x="0" y="0" width={plotWidth - rightPadding} height={plotHeight} />
              </clipPath>
            </defs>
            <g clipPath={`url(#${pipeClipId})`}>
              {pipeBars.map((bar) => (
                <g
                  key={bar.key}
                  stroke={bar.bullish ? '#2dd4a3' : '#ff6a75'}
                  strokeWidth="1.4"
                  strokeLinecap="round"
                >
                  <line x1={bar.x} y1={bar.yHigh} x2={bar.x} y2={bar.yLow} />
                  <line x1={bar.x - tickHalfWidth} y1={bar.yOpen} x2={bar.x} y2={bar.yOpen} />
                  <line x1={bar.x} y1={bar.yClose} x2={bar.x + tickHalfWidth} y2={bar.yClose} />
                </g>
              ))}
            </g>
          </svg>
        )}

        <div
          className="position-overlays"
          aria-hidden="true"
          style={{
            top: `${chartMargin.top}px`,
            right: `${chartMargin.right}px`,
            bottom: `${chartMargin.bottom}px`,
            left: `${chartMargin.left}px`,
          }}
        >
          {visiblePositions.map((position) => (
            <div
              key={position.id}
              className={`position-overlay-line ${position.side}`}
              style={{ top: `${position.topPercent}%` }}
            >
              <span className="position-overlay-label">
                {position.side === 'buy' ? 'LONG' : 'SHORT'} {position.leverage}x | ${formatPrice(position.price)}
              </span>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="fullscreen-fab"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? '⨉' : '⤢'}
        </button>
      </div>

      <div className={`live-price-tag ${isUp ? 'up' : 'down'}`}>
        ${formatPrice(latest?.y || 0)}
      </div>
    </div>
  );
}

export default Chart;
