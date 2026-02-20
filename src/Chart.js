import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { LineChart } from '@mui/x-charts/LineChart';

function Chart({
  width = 800,
  height = 500,
  data = [],
  positions = [],
  livePrice = 0,
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
  const [viewport, setViewport] = useState({ start: 0, end: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const pipeClipId = useId().replace(/:/g, '');
  const panStartRef = useRef({ x: 0, viewportStart: 0, viewportEnd: 1 });

  function resolveChartHeight({
    viewportWidth,
    viewportHeight,
    isTerminalFullscreen,
  }) {
    if (isTerminalFullscreen) {
      return Math.max(viewportHeight - 120, 320);
    }

    if (viewportWidth < 480) {
      return Math.min(Math.max(Math.round(viewportHeight * 0.44), 300), 430);
    }

    if (viewportWidth < 768) {
      return Math.min(Math.max(Math.round(viewportHeight * 0.5), 340), 520);
    }

    return height;
  }

  useEffect(() => {
    function updateChartSize() {
      const containerWidth = chartWrapperRef.current?.clientWidth || width;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const isChartFullscreen = document.fullscreenElement === chartTerminalRef.current;
      const nextHeight = resolveChartHeight({
        viewportWidth,
        viewportHeight,
        isTerminalFullscreen: isChartFullscreen,
      });

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
      const viewportHeight = window.innerHeight;
      const nextHeight = resolveChartHeight({
        viewportWidth,
        viewportHeight,
        isTerminalFullscreen: activeFullscreen,
      });
      setChartWidth(Math.max(Math.floor(containerWidth), 280));
      setChartHeight(nextHeight);
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [height, width]);

  useEffect(() => {
    setViewport({ start: 0, end: 1 });
  }, [timeStampRequest, data.length]);

  if (!data || data.length === 0) return null;

  const totalPoints = data.length;
  const minVisibleRange = Math.max((totalPoints > 1 ? 12 / (totalPoints - 1) : 1), 0.04);
  const clampedStart = Math.max(0, Math.min(viewport.start, 1));
  const clampedEnd = Math.max(clampedStart + minVisibleRange, Math.min(viewport.end, 1));
  const canResetView = clampedStart > 0.001 || clampedEnd < 0.999;
  const startIndex = Math.max(0, Math.floor(clampedStart * (totalPoints - 1)));
  const endIndex = Math.min(totalPoints - 1, Math.ceil(clampedEnd * (totalPoints - 1)));
  const visibleData = useMemo(() => {
    const sliced = data.slice(startIndex, endIndex + 1);
    return sliced.length >= 2 ? sliced : data;
  }, [data, startIndex, endIndex]);

  const yValues = visibleData.map((point) => point.y);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const range = Math.max(maxY - minY, 1);
  const padding = range * 0.08;

  const latest = visibleData[visibleData.length - 1];
  const previous = visibleData[visibleData.length - 2] || latest;
  const isUp = (latest?.y || 0) >= (previous?.y || 0);
  const displayedLivePrice = Number(livePrice) || Number(latest?.y || 0);

  const open = Number(visibleData[0]?.y || 0);
  const close = Number(latest?.y || 0);
  const high = maxY;
  const low = minY;
  const change = open ? ((close - open) / open) * 100 : 0;
  const isCompactChart = !isFullscreen && chartWidth < 768;
  const chartMargin = isCompactChart
    ? { top: 12, right: 54, bottom: 20, left: 10 }
    : { top: 16, right: 72, bottom: 22, left: 20 };
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
  const minTime = visibleData[0]?.x?.getTime?.() || 0;
  const maxTime = visibleData[visibleData.length - 1]?.x?.getTime?.() || minTime + 1;
  const timeRange = Math.max(maxTime - minTime, 1);
  const tickHalfWidth = Math.max(Math.min(plotWidth / Math.max(visibleData.length * 3, 1), 6), 2);
  const leftPadding = tickHalfWidth + 2;
  const rightPadding = tickHalfWidth + (isCompactChart ? 40 : 56);
  const xDrawableWidth = Math.max(plotWidth - leftPadding - rightPadding, 1);

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  const pipeBars = visibleData.map((point, index) => {
    const prev = visibleData[index - 1]?.y ?? point.y;
    const next = visibleData[index + 1]?.y ?? point.y;
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

  function resetViewport() {
    setViewport({ start: 0, end: 1 });
  }

  function handleWheel(event) {
    if (!isFullscreen) return;
    event.preventDefault();

    const rect = chartWrapperRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;

    const xRatio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    setViewport((current) => {
      const currentRange = current.end - current.start;
      const zoomFactor = event.deltaY > 0 ? 1.14 : 0.86;
      let nextRange = Math.min(Math.max(currentRange * zoomFactor, minVisibleRange), 1);
      const anchor = current.start + xRatio * currentRange;
      let nextStart = anchor - xRatio * nextRange;
      let nextEnd = nextStart + nextRange;

      if (nextStart < 0) {
        nextStart = 0;
        nextEnd = nextRange;
      }
      if (nextEnd > 1) {
        nextEnd = 1;
        nextStart = 1 - nextRange;
      }
      return { start: nextStart, end: nextEnd };
    });
  }

  function handlePointerDown(event) {
    if (!isFullscreen) return;
    if (event.target instanceof Element && event.target.closest('.fullscreen-fab')) return;
    const rect = chartWrapperRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;

    panStartRef.current = {
      x: event.clientX,
      viewportStart: viewport.start,
      viewportEnd: viewport.end,
    };
    setIsPanning(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!isFullscreen || !isPanning) return;
    const rect = chartWrapperRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;

    const dxRatio = (event.clientX - panStartRef.current.x) / rect.width;
    const rangeWidth = panStartRef.current.viewportEnd - panStartRef.current.viewportStart;
    let nextStart = panStartRef.current.viewportStart - dxRatio * rangeWidth;
    let nextEnd = panStartRef.current.viewportEnd - dxRatio * rangeWidth;

    if (nextStart < 0) {
      nextStart = 0;
      nextEnd = rangeWidth;
    }
    if (nextEnd > 1) {
      nextEnd = 1;
      nextStart = 1 - rangeWidth;
    }
    setViewport({ start: nextStart, end: nextEnd });
  }

  function handlePointerUp(event) {
    if (!isPanning) return;
    setIsPanning(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  useEffect(() => {
    if (!isFullscreen) return undefined;

    function handleKeyDown(event) {
      const key = event.key.toLowerCase();
      if (key === 'r') {
        setViewport({ start: 0, end: 1 });
      }
      if (key === 'f') {
        if (document.fullscreenElement === chartTerminalRef.current) {
          void document.exitFullscreen().catch(() => {});
          return;
        }
        void chartTerminalRef.current?.requestFullscreen?.().catch(() => {});
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

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
          {isFullscreen && (
            <button
              type="button"
              className="chart-reset-btn"
              onClick={resetViewport}
              disabled={!canResetView}
            >
              Reset
            </button>
          )}
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
      {isFullscreen && (
        <p className="chart-fullscreen-hint">Scroll to zoom, drag to pan, press R to reset.</p>
      )}

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

      <div
        className={`chart-wrapper ${isFullscreen ? 'zoomable' : ''} ${isPanning ? 'panning' : ''}`}
        ref={chartWrapperRef}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onDoubleClick={() => {
          if (isFullscreen) resetViewport();
        }}
      >
        <LineChart
          width={chartWidth}
          height={chartHeight}
          dataset={visibleData}
          skipAnimation={isFullscreen}
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
              transition: isFullscreen ? 'none !important' : undefined,
            },
            '& .MuiAreaElement-root': {
              fill: chartType === 'line'
                ? (isUp ? 'rgba(45, 212, 163, 0.13)' : 'rgba(255, 106, 117, 0.13)')
                : 'rgba(0,0,0,0)',
              transition: isFullscreen ? 'none !important' : undefined,
            },
            '& .MuiChartsGrid-line': {
              stroke: 'rgba(126, 147, 190, 0.18)',
              strokeDasharray: '5 4',
            },
            '& .MuiChartsAxis-line': { stroke: 'rgba(126, 147, 190, 0.3)' },
            '& .MuiChartsAxis-tick': { stroke: 'rgba(126, 147, 190, 0.3)' },
            '& .MuiChartsAxis-tickLabel': {
              fill: '#8f9abc',
              fontSize: isCompactChart ? 10 : 11,
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
          className={`fullscreen-fab ${isFullscreen ? 'is-active' : ''}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? 'Exit' : 'Full'}
        </button>
      </div>

      <div className={`live-price-tag ${isUp ? 'up' : 'down'}`}>
        ${formatPrice(displayedLivePrice)}
      </div>
    </div>
  );
}

export default Chart;
