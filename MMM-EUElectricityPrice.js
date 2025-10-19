Module.register("MMM-EUElectricityPrice", {
  validDataSources: ['EE', 'LT', 'LV', 'AT', 'BE', 'FR', 'DE', 'NL', 'PL', 'DK1', 'DK2', 'FI', 'NO1', 'NO2', 'NO3', 'NO4', 'NO5', 'SE1', 'SE2', 'SE3', 'SE4', 'SYS'],
  validCurrencies: ['NOK', 'SEK', 'DKK', 'PLN', 'EUR'],
  defaults: {
    dataSource: 'NO1',
    currency: 'NOK',
    centName: 'øre',
    displayInSubunit: false,
    headText: 'Electricity Price',
    customText: '',
    showCurrency: true,
    tomorrowDataTime: false,
    tomorrowDataTimeMinute: 1,
    errorMessage: 'Data could not be fetched.',
    loadingMessage: 'Loading data...',
    showPastHours: null,
    showFutureHours: 36,
    totalHours: 40,
    hourOffset: 1,
    priceOffset: 0,
    priceMultiplier: 1,
    gridPriceRules: [
      { from: '06:00', to: '22:00', add: 47.66 },
      { from: '22:00', to: '06:00', add: 32.66 }
    ],
    width: null,
    height: null,
    posRight: null,
    posDown: null,
    chartType: 'bar',
    showAverage: true,
    averageColor: '#fff',
    showGrid: true,
    gridColor: 'rgba(255, 255, 255, 0.3)',
    labelColor: '#fff',
    pastColor: 'rgba(255, 255, 255, 0.5)',
    pastBg: 'rgba(255, 255, 255, 0.3)',
    currentColor: '#CC7722',
    currentBg: '#CC7722',
    normalColor: '#3b82f6',
    currentbgSwitch: false,
    futureColor: 'rgba(255, 255, 255, 0.8)',
    futureBg: 'rgba(255, 255, 255, 0.6)',
    lineColor: null,
    pastLineColor: 'rgba(255,255,255,0.5)',
    futureLineColor: 'rgba(255,255,255,0.6)',
    alertLimit: false,
    alertValue: 100,
    alertColor: '#B22222',
    alertBg: '#B22222',
    safeLimit: false,
    safeValue: 50,
    safeColor: '#228B22',
    safeBg: '#228B22',
    beginAtZero: true,
    borderWidthLine: 3,
    pointRegular: 4,
    pointCurrent: 10,
    pointQuarter: 2,
    borderWidthBar: 1,
    tickInterval: false,
    updateUIInterval: 5 * 60,
    yDecimals: 2,
    resolution: 'hour',
    xLabelDiagonal: true,
    xLabelAngle: 60,
    xLabelPadding: 4,
    xAutoSkip: false,
    xMaxTicks: null,
    xLabelEveryHours: 1
  },

  getScripts: function () {
    return [this.file('chart-loader.js')];
  },

  start: function () {
    this.error = false;
    this.priceData = false;
    this.gridAddSubunit = 0;
    this.priceMetadata = {};
    this.timeout = false;
    this.schedulePriceUpdate();
    this.scheduleUIUpdate();
  },

  schedulePriceUpdate: function () {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = false;
    }
    this.getPriceData();

    const manualMode = (typeof this.config.tomorrowDataTime === 'number');
    const minutesInTZ = (tz) => {
      const now = new Date();
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      }).format(now).split(':').map(Number);
      const h = parts[0] || 0, m = parts[1] || 0;
      return h * 60 + m;
    };

    let nextDelay;
    const GRACE_MINUTES = 60;
    const POLL_EVERY_MS = 5 * 60 * 1000;

    if (manualMode) {
      const now = new Date();
      const publishTimeToday = new Date(
        now.getFullYear(), now.getMonth(), now.getDate(),
        this.config.tomorrowDataTime,
        this.config.tomorrowDataTimeMinute || 0, 0, 0
      );
      const publishTimeTomorrow = new Date(publishTimeToday.getTime() + 24 * 60 * 60 * 1000);

      if (now < publishTimeToday) {
        nextDelay = publishTimeToday.getTime() - now.getTime();
      } else if (now - publishTimeToday < GRACE_MINUTES * 60 * 1000) {
        nextDelay = POLL_EVERY_MS;
      } else {
        nextDelay = publishTimeTomorrow.getTime() - now.getTime();
      }
    } else {
      const TZ = 'Europe/Oslo';
      const TARGET_MIN = 13 * 60;
      const nowMin = minutesInTZ(TZ);
      if (nowMin < TARGET_MIN) {
        nextDelay = (TARGET_MIN - nowMin) * 60 * 1000;
      } else if (nowMin < TARGET_MIN + GRACE_MINUTES) {
        nextDelay = POLL_EVERY_MS;
      } else {
        const untilMidnight = (24 * 60 - nowMin) * 60 * 1000;
        const toTargetTomorrow = TARGET_MIN * 60 * 1000;
        nextDelay = untilMidnight + toTargetTomorrow;
      }
    }
    this.timeout = setTimeout(() => this.schedulePriceUpdate(), nextDelay);
  },

  scheduleUIUpdate: function () {
    setInterval(() => this.updateDom(), this.config.updateUIInterval * 1000);
    this.updateDom();
  },

  getPriceData: function () {
    let currency = this.config.currency;
    let urlToday, urlTomorrow, urlYesterday;
    let today = new Date();
    let formattedToday = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
    let yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    let formattedYesterday = `${yesterday.getFullYear()}-${yesterday.getMonth() + 1}-${yesterday.getDate()}`;
    let tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    let formattedTomorrow = `${tomorrow.getFullYear()}-${tomorrow.getMonth() + 1}-${tomorrow.getDate()}`;

    if (!this.validCurrencies.includes(this.config.currency)) {
      const errorMessage = `Please change currency to one of the valid ones. Current currency is set as ${currency}`;
      this.sendSocketNotification('INVALID_CURRENCY', errorMessage);
      this.setError(errorMessage);
      return;
    }

    if (!this.validDataSources.includes(this.config.dataSource)) {
      const errorMessage = `Please change dataSource to one of the valid ones. Current source is set as ${this.config.dataSource}`;
      this.sendSocketNotification('INVALID_DATASOURCE', errorMessage);
      this.setError(errorMessage);
      return;
    } else {
      urlYesterday = `https://dataportal-api.nordpoolgroup.com/api/DayAheadPrices?market=DayAhead&date=${formattedYesterday}&currency=${currency}&deliveryArea=${this.config.dataSource}`;
      urlToday = `https://dataportal-api.nordpoolgroup.com/api/DayAheadPrices?market=DayAhead&date=${formattedToday}&currency=${currency}&deliveryArea=${this.config.dataSource}`;
      urlTomorrow = `https://dataportal-api.nordpoolgroup.com/api/DayAheadPrices?market=DayAhead&date=${formattedTomorrow}&currency=${currency}&deliveryArea=${this.config.dataSource}`;
    }

    this.sendSocketNotification('GET_PRICEDATA', {
      urlToday,
      urlTomorrow,
      urlYesterday,
      tomorrowDataTime: this.config.tomorrowDataTime,
      hourOffset: this.config.hourOffset,
      priceOffset: this.config.priceOffset,
      priceMultiplier: this.config.priceMultiplier,
      dataSource: this.config.dataSource,
      validDataSources: this.validDataSources,
      gridPriceRules: this.config.gridPriceRules
    });
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "PRICEDATA") {
      this.error = false;
      this.priceData = payload.priceData;
      this.gridAddSubunit = payload.gridAddSubunit;
      if (this.priceData.length > 0) {
        let sum = 0;
        for (let i = 0; i < this.priceData.length; i++) sum += this.priceData[i].value;
        this.priceMetadata['average'] = sum / this.priceData.length;
      } else {
        this.priceMetadata['average'] = false;
      }
    } else if (notification === "PRICEDATAERROR") {
      this.setError(`Data fetch issue: ${payload || 'Unknown error'}`);
    } else if (notification === "INVALID_DATASOURCE") {
      this.setError(payload);
    }
    this.updateDom();
  },

  setError: function (message) {
    this.error = true;
    this.priceData = false;
    this.errorMessage = message || this.config.errorMessage;
    this.updateDom();
    setTimeout(() => this.schedulePriceUpdate(), 30 * 60 * 1000);
  },

  getDom: function () {
    const wrapper = document.createElement("div");
    if (this.config.width) {
      wrapper.style.width = this.config.width;
      wrapper.style.transform = `translate(${this.config.posRight}, ${this.config.posDown})`;
    }
    if (this.config.height) wrapper.style.height = this.config.height;

    if (this.error) {
      wrapper.innerHTML = this.errorMessage || this.config.errorMessage;
      wrapper.className = 'dimmed light small';
      return wrapper;
    }

    if (!this.priceData) {
      wrapper.innerHTML = this.config.loadingMessage;
      wrapper.className = 'dimmed light small';
      return wrapper;
    }

    // Display grid energy from helper
    const d2 = Math.max(0, Math.min(2, this.config.yDecimals));
    const gridEnergy = this.config.displayInSubunit
      ? (Math.round(this.gridAddSubunit)).toString()
      : (this.gridAddSubunit / 100).toFixed(d2);




    // Guard: Chart.js not loaded yet
    if (typeof Chart === 'undefined') {
      wrapper.innerHTML = 'Loading chart library...';
      wrapper.className = 'dimmed light small';
      setTimeout(() => this.updateDom(), 1500);
      return wrapper;
    }

    // Display scaling (main vs sub-unit)
const DISPLAY_FACTOR = this.config.displayInSubunit ? 100 : 1;
// Label for axis and info strip
const unitLabel = this.config.displayInSubunit ? this.config.centName : this.config.currency;

    // --- Current slot (rounded down to nearest 15 min) ---
    let now = new Date();
    const minutesRounded = Math.floor(now.getMinutes() / 15) * 15;
    let currentSlot = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      minutesRounded, 0, 0
    );
    currentSlot = new Date(currentSlot - currentSlot.getTimezoneOffset() * 60000).toISOString();
    const currentDate = currentSlot.substring(0, 10);
    const currentTime = currentSlot.substring(11, 19); // HH:MM:SS

    let currentHourMark = false;
    for (let i = 0; i < this.priceData.length; i++) {
      if (this.priceData[i].date == currentDate && this.priceData[i].time == currentTime) {
        currentHourMark = i; break;
      }
    }
    if (currentHourMark === false) {
      this.setError();
      wrapper.innerHTML = this.config.errorMessage;
      wrapper.className = 'dimmed light small';
      return wrapper;
    }

    // --- Window calculation (chronological arrays) ---
    const Q = 4; // quarters per hour

    // how many quarters to show into the *future* (to the right)
    const FUTURE_Q = (this.config.showFutureHours === false)
      ? 0
      : Math.max(0, Math.round(this.config.showFutureHours * Q));

    // how many quarters to show into the *past* (to the left)
    let PAST_Q;
    if (this.config.showPastHours === false) {
      PAST_Q = 0;
    } else if (this.config.showPastHours === null || this.config.showPastHours === 0) {
      // default: fill up to totalHours
      const totalQ = Math.max(0, Math.round((this.config.totalHours || 0) * Q));
      PAST_Q = Math.max(0, totalQ - FUTURE_Q); // remaining quarters go to the past
    } else {
      PAST_Q = Math.max(0, Math.round(this.config.showPastHours * Q));
    }

    // compute window [startIdx..endIdx]
    const startIdx = Math.max(0, currentHourMark - PAST_Q);
    const endIdx = Math.min(this.priceData.length - 1, currentHourMark + FUTURE_Q);


    // --- Build base arrays (quarters) ---
    const showData = [];
    const showLabel = [];
    const showColor = [];
    const showBg = [];
    const showDate = []; // track date for hourly aggregation

    let alertValue = null;
    let safeValue = null;
    if (this.config.alertLimit !== false) {
      alertValue = (this.config.alertValue == 'average') ? this.priceMetadata['average'] : this.config.alertValue * 10;
    }
    if (this.config.safeLimit !== false) {
      safeValue = (this.config.safeValue == 'average') ? this.priceMetadata['average'] : this.config.safeValue * 10;
    }

for (let i = startIdx; i <= endIdx; i++) {
  const { value, time, date } = this.priceData[i];

  // ⚡ final price (base + offset + grid) is already in value
  const displayVal = (value / 1000) * DISPLAY_FACTOR;

  showData.push(displayVal);
  showLabel.push(time[0] === '0' ? time.substring(1, 5) : time.substring(0, 5));
  showDate.push(date);

  if (i === currentHourMark) {
    showColor.push(this.config.currentColor);
    showBg.push(this.config.futureBg);
  } else if (i < currentHourMark) {
    showColor.push(this.config.pastColor);
    showBg.push(this.config.pastBg);
  } else {
    if (this.config.alertLimit !== false && displayVal > alertValue) {
      showColor.push(this.config.alertColor);
      showBg.push(this.config.alertBg);
    } else if (this.config.safeLimit !== false && displayVal < safeValue) {
      showColor.push(this.config.safeColor);
      showBg.push(this.config.safeBg);
    } else {
      showColor.push(this.config.normalColor);
      showBg.push(this.config.futureBg);
    }
  }
}



    // ---- Resolution switch ----
    let dispData = showData.slice();
    let dispLabel = showLabel.slice();
    let dispColor = showColor.slice();
    let dispBg = showBg.slice();
    let dispDate = showDate.slice();

    const hourOnly = (lbl) => String(lbl).split(':')[0].padStart(2, '0') + ':00';

    if (this.config.resolution === 'hour') {
      // Aggregate by DATE + HOUR
      const buckets = {}; // key "YYYY-MM-DD HH:00" -> { sum, n, color, bg }
      const order = []; // preserve first-seen order

      for (let idx = 0; idx < dispLabel.length; idx++) {
        const keyHour = hourOnly(dispLabel[idx]);
        const key = `${dispDate[idx]} ${keyHour}`;
        if (!buckets[key]) {
          buckets[key] = { sum: 0, n: 0, color: dispColor[idx], bg: dispBg[idx] };
          order.push(key);
        }
        buckets[key].sum += dispData[idx];
        buckets[key].n += 1;
      }

      dispLabel = order.map(k => k.slice(11));      // "HH:00" for axis
      dispData = order.map(k => buckets[k].sum / buckets[k].n);
      dispDate = order.map(k => k.slice(0, 10));    // keep date for current marker

      const currentHourLabelAgg = hourOnly(showLabel[currentHourMark - startIdx]);
      const currentDateStrAgg = showDate[currentHourMark - startIdx];
      let currentDispIndex = dispLabel.findIndex((lbl, idx) =>
        dispDate[idx] === currentDateStrAgg && lbl === currentHourLabelAgg
      );
      if (currentDispIndex < 0) currentDispIndex = 0;

      dispColor = dispData.map((val, idx) => {
        const raw = val * 1000;
        if (idx === currentDispIndex) return this.config.currentColor;
        if (idx < currentDispIndex) return this.config.pastColor;
        if (this.config.alertLimit !== false && raw > alertValue) return this.config.alertColor;
        if (this.config.safeLimit !== false && raw < safeValue) return this.config.safeColor;
        return this.config.normalColor;
      });
    }

    // --- Chart DOM ---
    const chart = document.createElement("div");
    chart.className = 'small light';
    const canvas = document.createElement('canvas');

    // Average line across displayed data
    let averageSet = {};
    if (this.config.showAverage) {
      const sumDisp = dispData.reduce((a, b) => a + b, 0);
      const avgDisp = dispData.length ? sumDisp / dispData.length : 0;
      averageSet = {
        type: 'line',
        label: 'Average',
        data: Array(dispData.length).fill(avgDisp),
        color: this.config.averageColor,
        borderColor: this.config.averageColor,
        fill: false,
        pointRadius: 0,
        order: 1,
        datalabels: { display: false },

      };
    }

    const gridConfig = this.config.showGrid
      ? { display: true, color: this.config.gridColor }
      : { display: false };

    const self = this;
    const borderWidth = (this.config.chartType === 'line') ? this.config.borderWidthLine : this.config.borderWidthBar;
    const diagonal = !!this.config.xLabelDiagonal;
    const angle = Math.max(0, Math.min(90, this.config.xLabelAngle || 60));
    // Build chart (guarded)
    let myChart = null;
    try {
      myChart = new Chart(canvas, {
        type: this.config.chartType,
        data: {
          labels: dispLabel,
          datasets: [{
            label: `${unitLabel}/kWh`,
            type: this.config.chartType,
            data: dispData,

            backgroundColor: this.config.chartType === 'line' ? 'rgba(0,0,0,0)' : dispBg,
            borderColor: this.config.chartType === 'line'
              ? (this.config.lineColor || this.config.futureLineColor)
              : dispColor,
            borderWidth: borderWidth,
            barPercentage: 0.75,
            order: 2,
            datalabels: { display: false },

            // node colors
            pointBackgroundColor: this.config.chartType === 'line' ? dispColor : undefined,
            pointBorderColor: this.config.chartType === 'line' ? dispColor : undefined,

            // ✅ segment belongs here (inside dataset)
            segment: (this.config.chartType === 'line' && !this.config.lineColor) ? {
              borderColor: (ctx) => {
                const i = ctx.p0DataIndex;
                let currentDispIndex;

                if (this.config.resolution === 'quarter') {
                  // AFTER (chronological arrays)
                  currentDispIndex = (currentHourMark - startIdx);
                } else {
                  // your existing hour-mode findIndex stays as-is
                  const hourOnly = (lbl) => String(lbl).split(':')[0].padStart(2, '0') + ':00';
                  const currentHourLabel = hourOnly(showLabel[currentHourMark - startIdx]);
                  const currentDateStr = showDate[currentHourMark - startIdx];
                  currentDispIndex = dispLabel.findIndex((lbl, idx) =>
                    (dispDate[idx] === currentDateStr && lbl === currentHourLabel)
                  );
                  if (currentDispIndex < 0) currentDispIndex = 0;
                }

                return (i < currentDispIndex) ? this.config.pastLineColor : this.config.futureLineColor;
              }
            } : undefined

          }]
            .concat(this.config.showAverage ? [averageSet] : [])
        },

        options: {
          scales: {
            y: {
              grid: gridConfig,
              beginAtZero: this.config.beginAtZero,
              ticks: {
                color: this.config.labelColor,
                callback: function (value) {
                  const d = Math.max(0, Math.min(2, self.config.yDecimals));
                  return Number(value).toFixed(d);
                }
              }
            },
            x: {
              ticks: {
                color: this.config.labelColor,

                // Control autoskip & density
                autoSkip: !!this.config.xAutoSkip,
                maxTicksLimit: (typeof this.config.xMaxTicks === 'number')
                  ? this.config.xMaxTicks
                  : (this.config.resolution === 'hour' ? 24 : undefined),

                // Rotate (your diagonal settings)
                maxRotation: diagonal ? angle : 0,
                minRotation: diagonal ? angle : 0,
                padding: this.config.xLabelPadding ?? 4,
                align: diagonal ? 'end' : 'center',

                // Decide which labels to render
                callback: function (value) {
                  const val = this.getLabelForValue(value); // e.g. "HH:MM"
                  const step = Math.max(1, Number(self.config.xLabelEveryHours || 1));

                  if (self.config.resolution === 'hour') {
                    // labels are "HH:00"
                    const hh = parseInt(String(val).slice(0, 2), 10);
                    return (hh % step === 0) ? val : '';
                  } else {
                    // quarter resolution: only label full hours that match step
                    // existing behavior keeps only HH:00; now also apply modulo step
                    if (typeof val !== 'string') return '';
                    const isFullHour = val.slice(-2) === '00';
                    if (!isFullHour) return '';
                    const hh = parseInt(val.slice(0, 2), 10);
                    return (hh % step === 0) ? val : '';
                  }
                }
              },
              grid: this.config.showGrid ? {
                color: (ctx) => {
                  if (self.config.resolution === 'hour') return self.config.gridColor;
                  const lbl = String(ctx.tick?.label || '');
                  const mm = lbl.slice(-2);
                  return (mm === '00') ? self.config.gridColor : 'rgba(0,0,0,0)';
                },
                tickColor: (ctx) => {
                  if (self.config.resolution === 'hour') return self.config.labelColor;
                  const lbl = String(ctx.tick?.label || '');
                  const mm = lbl.slice(-2);
                  return (mm === '00') ? self.config.labelColor : 'rgba(0,0,0,0)';
                }
              } : undefined
            }
          },
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: (this.config.chartType === 'line' && this.config.resolution === 'quarter')
              ? {
                filter: (ctx) => {
                  const lbl = ctx.label || '';
                  const mm = typeof lbl === 'string' ? lbl.slice(-2) : '';
                  const currentIdxDisplayed = (currentHourMark - startIdx);
                  const isCurrent = ctx.dataIndex === currentIdxDisplayed;
                  const isHour = (mm === '00');
                  return isHour || isCurrent;
                }
              }
              : {}
          }
        }
      });
    } catch (err) {
      console.error('Chart init failed, retrying:', err);
      wrapper.innerHTML = 'Initializing chart…';
      wrapper.className = 'dimmed light small';
      setTimeout(() => this.updateDom(), 1500);
      return wrapper;
    }

    // ---- Point sizes (line chart) ----
    if (this.config.chartType === 'line') {
      let pointSizes = [];
      if (this.config.resolution === 'quarter') {
        const currentIdxDisplayed = (currentHourMark - startIdx);
        pointSizes = dispLabel.map((lbl, idx) => {
          const mm = String(lbl).slice(-2);
          if (idx === currentIdxDisplayed) return this.config.pointCurrent; // current big
          if (mm === '00') return this.config.pointRegular;  // full-hour node
          return this.config.pointQuarter;                                  // mini nodes
        });
      } else { // hour mode
        const currentHourLabel = hourOnly(showLabel[currentHourMark - startIdx]); // "HH:00"
        const currentDateStr = showDate[currentHourMark - startIdx];            // "YYYY-MM-DD"
        pointSizes = dispLabel.map((lbl, idx) =>
          (dispDate[idx] === currentDateStr && lbl === currentHourLabel)
            ? this.config.pointCurrent
            : this.config.pointRegular
        );
      }
      myChart.data.datasets[0].pointRadius = pointSizes;
      myChart.update('none');
    }

// "Now" value (scaled for display)
const currentValue = (this.priceData[currentHourMark].value / 1000 * DISPLAY_FACTOR).toFixed(d2);

// Average over displayed series (dispData is already scaled if you pushed with DISPLAY_FACTOR)
const dispAvg = dispData.length
  ? (dispData.reduce((a, b) => a + b, 0) / dispData.length).toFixed(d2)
  : '--';

// past 24h stats (raw data slice, scale for display here)
const past24 = this.priceData.slice(Math.max(currentHourMark - 24 * 4, 0), currentHourMark);
const low24  = past24.length ? (Math.min(...past24.map(i => i.value)) / 1000 * DISPLAY_FACTOR).toFixed(d2) : '--';
const high24 = past24.length ? (Math.max(...past24.map(i => i.value)) / 1000 * DISPLAY_FACTOR).toFixed(d2) : '--';

// --- templating + gridEnergy tag (from node_helper) ---
const renderCustomText = (tpl, map) =>
  tpl ? String(tpl).replace(/{{\s*(\w+)\s*}}/g, (m, k) => (k in map ? map[k] : '')) : '';

const customTextRendered = renderCustomText(this.config.customText, {
  price: currentValue,
  avg: dispAvg,
  low24: low24,
  high24: high24,
  date: currentDate,
  time: currentTime.slice(0,5),
  currency: this.config.currency,
  centName: this.config.centName,
  area: this.config.dataSource,
  gridEnergy: gridEnergy
});




    const infoDiv = document.createElement("div");
    infoDiv.className = 'bright';
    infoDiv.innerHTML = `
        <div style="@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300&display=swap'); font-family: 'Roboto', sans-serif;">
          <span style="font-size: 1.2em; font-weight: bold;">${this.config.headText} ${this.config.showCurrency ? this.config.currency : ''}</span><br>
${this.config.customText ? `<span style="font-size: 0.6em;">${customTextRendered}</span><br>` : ''}
          <span style="font-size: 0.8em;">Now: </span>
<span style="font-size: 1.2em; font-weight: bold;">${currentValue}</span>
<span style="font-size: 0.8em;"> ${unitLabel}/kWh</span>
          <br>
          <span style="font-size: 0.6em;">
  <span style="color: blue;">&darr;</span> ${low24} ${unitLabel}
            <span style="color: #aaa;">&nbsp;&bull;&nbsp;</span> 
<span style="color: red;">&uarr;</span> ${high24} ${unitLabel}
            <span style="color: #aaa;">&nbsp;&bull;&nbsp;</span> 
            ≈ ${dispAvg} ${unitLabel}
          </span>
        </div>
      `;

    wrapper.appendChild(infoDiv);
    chart.appendChild(canvas);
    wrapper.appendChild(chart);
    return wrapper;
  }
});
