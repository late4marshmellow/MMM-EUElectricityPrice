/* Magic Mirror
 * Module: MMM-EUElectricityPrice
 *
 * By late4marshmellow a fork from JanneKalliola (MMM-FiElectricityPrice)
 *
 */

Module.register("MMM-EUElectricityPrice", {
  validDataSources: ['EE', 'LT', 'LV', 'AT', 'BE', 'FR', 'GER', 'NL', 'PL', 'DK1', 'DK2', 'FI', 'NO1', 'NO2', 'NO3', 'NO4', 'NO5', 'SE1', 'SE2', 'SE3', 'SE4', 'SYS'],
  validCurrencies: ['NOK', 'SEK', 'DKK', 'PLN', 'EUR'],
  defaults: {
    dataSource: 'NO1',
    currency: 'NOK',
    centName: 'øre',
    headText: 'Electricity Price',
    customText: '',
    showCurrency: true,
    tomorrowDataTime: 13, //set to false if you want standard settings
    tomorrowDataTimeMinute: 1, //ignored if tomorrowDataTime is false
    errorMessage: 'Data could not be fetched.',
    loadingMessage: 'Loading data...',
    showPastHours: null,
    showFutureHours: 36,
    totalHours: 40,
    hourOffset: 1,
    priceOffset: 0,
    priceMultiplier: 1,
    // size/position
    width: null,
    height: null,
    posRight: null,
    posDown: null,
    // chart
    chartType: 'bar', // 'line' | 'bar'
    showAverage: true,
    averageColor: '#fff',
    showGrid: true,
    gridColor: 'rgba(255, 255, 255, 0.3)',
    labelColor: '#fff',
    pastColor: 'rgba(255, 255, 255, 0.5)',
    pastBg: 'rgba(255, 255, 255, 0.3)',
    currentColor: '#fff',
    currentBg: '#fff',
    currentbgSwitch: false,
    futureColor: 'rgba(255, 255, 255, 0.8)',
    futureBg: 'rgba(255, 255, 255, 0.6)',
    alertLimit: false,
    alertValue: 100,
    alertColor: 'rgba(255, 0, 0, 1)',
    alertBg: 'rgba(255, 0,0, 0.8)',
    safeLimit: false,
    safeValue: 50,
    safeColor: 'rgba(0, 255, 0, 1)',
    safeBg: 'rgba(0, 255,0, 0.8)',
    beginAtZero: true,
    // line chart only
    borderWidthLine: 3,
    pointRegular: 4,   // full-hour node size (line)
    pointCurrent: 10,  // current node size (line)
    pointQuarter: 2,   // 15/30/45 mini nodes (line)
    // bar chart only
    borderWidthBar: 1,
    // Other
    tickInterval: false,
    updateUIInterval: 5 * 60,
    yDecimals: 2,
    // Resolution switch
    resolution: 'hour', // 'quarter' (15-min) | 'hour' (aggregate per date+hour)
    // chart label rotation
    xLabelDiagonal: true,   // if true, rotate labels
    xLabelAngle: 60,        // angle in degrees for diagonal labels (e.g., 45–70 is typical)
    xLabelPadding: 4,       // extra padding so labels don’t clip
    xAutoSkip: false,     // let Chart.js auto-thin labels
    xMaxTicks: null,     // cap number of x ticks (null = let Chart.js decide)
    xLabelEveryHours: 1, // show a label every N hours (works in both hour/quarter modes)

  },

  // If you use Chart.js v4, keep this path (UMD). For v3, use 'dist/chart.min.js'
  getScripts: function () {
    return [this.file('chart-loader.js')];
  },

  start: function () {
    this.error = false;
    this.priceData = false;
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

    // Always try now (triggers helper fetch)
    this.getPriceData();

    // MODE:
    // - Manual override (back-compat): tomorrowDataTime is a number -> use local device clock at that HH:MM
    // - Hardened Oslo mode: tomorrowDataTime === false -> use 13:00 Europe/Oslo
    const manualMode = (typeof this.config.tomorrowDataTime === 'number');

    // helper: today at HH:MM in a *given* IANA timezone, mapped to a local Date for scheduling
    const dateAtTZLocalDay = (tz, hour, minute) => {
      const now = new Date();
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(now);
      const y = parts.find(p => p.type === 'year').value;
      const m = parts.find(p => p.type === 'month').value;
      const d = parts.find(p => p.type === 'day').value;
      // Create a local Date that corresponds to that TZ’s current calendar day at hour:minute
      return new Date(`${y}-${m}-${d}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
    };

    // Compute publish time “today” and “tomorrow”
    const now = new Date();
    const publishTimeToday = manualMode
      ? new Date(
        now.getFullYear(), now.getMonth(), now.getDate(),
        this.config.tomorrowDataTime,
        this.config.tomorrowDataTimeMinute || 0,
        0, 0
      )
      : dateAtTZLocalDay('Europe/Oslo', 13, 0); // Hardened Oslo time

    const publishTimeTomorrow = new Date(publishTimeToday.getTime() + 24 * 60 * 60 * 1000);

    // Polling window after publish to catch late postings
    const GRACE_MINUTES = 60;
    const POLL_EVERY_MS = 5 * 60 * 1000;

    let nextDelay;
    if (now < publishTimeToday) {
      // Not yet at publish time -> sleep until publish
      nextDelay = publishTimeToday.getTime() - now.getTime();
    } else if (now - publishTimeToday < GRACE_MINUTES * 60 * 1000) {
      // Within grace window -> poll every 5 minutes
      nextDelay = POLL_EVERY_MS;
    } else {
      // Past grace window -> schedule for tomorrow’s publish
      nextDelay = publishTimeTomorrow.getTime() - now.getTime();
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
    });
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "PRICEDATA") {
      this.error = false;
      this.priceData = payload;
      if (this.priceData.length > 0) {
        let sum = 0;
        for (let i = 0; i < this.priceData.length; i++) sum += this.priceData[i].value;
        this.priceMetadata['average'] = sum / this.priceData.length;
      } else {
        this.priceMetadata['average'] = false;
      }
    } else if (notification === "PRICEDATAERROR") {
      console.log("Error:", payload);
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

    // Guard: Chart.js not loaded yet
    if (typeof Chart === 'undefined') {
      wrapper.innerHTML = 'Loading chart library...';
      wrapper.className = 'dimmed light small';
      setTimeout(() => this.updateDom(), 1500);
      return wrapper;
    }

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

    // --- Window calculation (uses existing config semantics) ---
    let futureMark = 0;
    let pastMark = this.priceData.length - 1;

    if (this.config.showFutureHours !== false) {
      futureMark = Math.max(currentHourMark - this.config.showFutureHours * 4, 0);
    }

    let showPastHours = this.config.showPastHours * 4;
    if (showPastHours === null | showPastHours === 0) {
      showPastHours = this.config.totalHours * 4 - (currentHourMark - futureMark);
      showPastHours = Math.max(showPastHours, 0);
    }
    if (showPastHours !== false) {
      pastMark = Math.min(currentHourMark + showPastHours, this.priceData.length - 1);
    }

    // --- Build base arrays (quarters) ---
    const showData = [];
    const showLabel = [];
    const showColor = [];
    const showBg = [];
    const showDate = []; // track date for hourly aggregation

    let alertValue = null;
    let safeValue = null;
    if (this.config.alertLimit !== false) {
      alertValue = (this.config.alertValue == 'average') ? this.priceMetadata['average'] : this.config.alertValue * 1000;
    }
    if (this.config.safeLimit !== false) {
      safeValue = (this.config.safeValue == 'average') ? this.priceMetadata['average'] : this.config.safeValue * 1000;
    }

    for (let i = futureMark; i <= pastMark; i++) {
      const { value, time, date } = this.priceData[i];
      // data
      showData.unshift(value / 1000);
      // labels "H:MM" or "HH:MM"
      showLabel.unshift(time[0] === '0' ? time.substring(1, 5) : time.substring(0, 5));
      // date
      showDate.unshift(date);
      // colors/bg
      if (i === currentHourMark) {
        showColor.unshift(this.config.currentColor);
        showBg.unshift(this.config.currentbgSwitch ? this.config.currentBg : this.config.futureBg);
      } else if (i > currentHourMark) {
        showColor.unshift(this.config.pastColor);
        showBg.unshift(this.config.pastBg);
      } else if (this.config.alertLimit !== false && value > alertValue) {
        showColor.unshift(this.config.alertColor);
        showBg.unshift(this.config.alertBg);
      } else if (this.config.safeLimit !== false && value < safeValue) {
        showColor.unshift(this.config.safeColor);
        showBg.unshift(this.config.safeBg);
      } else {
        showColor.unshift(this.config.futureColor);
        showBg.unshift(this.config.futureBg);
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
      dispColor = order.map(k => buckets[k].color);
      dispBg = order.map(k => buckets[k].bg);
      dispDate = order.map(k => k.slice(0, 10));    // keep date for current marker
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
        datalabels: { display: false }
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
            label: `${this.config.centName}/kWh`,
            type: this.config.chartType,
            data: dispData,
            backgroundColor: dispBg,
            borderColor: dispColor,
            borderWidth: borderWidth,
            barPercentage: 0.75,
            order: 2,
            datalabels: { display: false }
          }].concat(this.config.showAverage ? [averageSet] : [])
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
                  const currentIdxDisplayed = (pastMark - currentHourMark);
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
        const currentIdxDisplayed = (pastMark - currentHourMark);
        pointSizes = dispLabel.map((lbl, idx) => {
          const mm = String(lbl).slice(-2);
          if (idx === currentIdxDisplayed) return this.config.pointCurrent; // current big
          if (mm === '00') return this.config.pointRegular;  // full-hour node
          return this.config.pointQuarter;                                  // mini nodes
        });
      } else { // hour mode
        const currentHourLabel = hourOnly(showLabel[pastMark - currentHourMark]); // "HH:00"
        const currentDateStr = showDate[pastMark - currentHourMark];            // "YYYY-MM-DD"
        pointSizes = dispLabel.map((lbl, idx) =>
          (dispDate[idx] === currentDateStr && lbl === currentHourLabel)
            ? this.config.pointCurrent
            : this.config.pointRegular
        );
      }
      myChart.data.datasets[0].pointRadius = pointSizes;
      myChart.update('none');
    }

    // --- Info strip (now, min/max, avg over displayed) ---
    const currentValue = (this.priceData[currentHourMark].value / 1000).toFixed(2);
    const dispAvg = dispData.length ? (dispData.reduce((a, b) => a + b, 0) / dispData.length).toFixed(2) : '--';

    // past 24h stats (raw data, regardless of resolution)
    const past24 = this.priceData.slice(Math.max(currentHourMark - 24 * 4, 0), currentHourMark);
    const low24 = past24.length ? (Math.min(...past24.map(i => i.value)) / 1000).toFixed(2) : '--';
    const high24 = past24.length ? (Math.max(...past24.map(i => i.value)) / 1000).toFixed(2) : '--';

    const infoDiv = document.createElement("div");
    infoDiv.className = 'bright';
    infoDiv.innerHTML = `
      <div style="@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300&display=swap'); font-family: 'Roboto', sans-serif;">
        <span style="font-size: 1.2em; font-weight: bold;">${this.config.headText} ${this.config.showCurrency ? this.config.currency : ''}</span><br>
        ${this.config.customText ? `<span style="font-size: 0.6em;">${this.config.customText}</span><br>` : ''}
        <span style="font-size: 0.8em;">Now: </span>
        <span style="font-size: 1.2em; font-weight: bold;">${currentValue}</span>
        <span style="font-size: 0.8em;"> ${this.config.centName}/kWh</span>
        <br>
        <span style="font-size: 0.6em;">
          <span style="color: blue;">&darr;</span> ${low24} ${this.config.centName}  
          <span style="color: #aaa;">&nbsp;&bull;&nbsp;</span> 
          <span style="color: red;">&uarr;</span> ${high24} ${this.config.centName} 
          <span style="color: #aaa;">&nbsp;&bull;&nbsp;</span> 
          ≈ ${dispAvg} ${this.config.centName}
        </span>
      </div>
    `;

    wrapper.appendChild(infoDiv);
    chart.appendChild(canvas);
    wrapper.appendChild(chart);
    return wrapper;
  }
});
