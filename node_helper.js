/* MagicMirror²
 * Module: MMM-EUElectricityPrice
 *
 * By late4marshmellow a fork from JanneKalliola (MMM-FiElectricityPrice)
 *
 */
const NodeHelper = require('node_helper');
const https = require('node:https');

const DEFAULT_TIMEOUT_MS = 8000;

function getJsonWithRetry(url, retries = 2, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const req = https.get(url, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return n > 0
            ? setTimeout(() => attempt(n - 1), 500 * (retries - n + 1))
            : reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) {
            return n > 0
              ? setTimeout(() => attempt(n - 1), 500 * (retries - n + 1))
              : reject(new Error(`JSON parse error for ${url}: ${e.message}`));
          }
        });
      });
      req.on('error', (e) => n > 0
        ? setTimeout(() => attempt(n - 1), 500 * (retries - n + 1))
        : reject(e));
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Timeout after ${timeoutMs}ms for ${url}`));
      });
    };
    attempt(retries);
  });
}

function pad2(n) { return String(n).padStart(2, '0'); }

function hhmmToMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

function getHHMMWithHourOffset(utcIso, hourOffset) {
  const d = new Date(utcIso);
  d.setTime(d.getTime() + (Number(hourOffset) || 0) * 60 * 60 * 1000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function computeGridPriceAdderSubunit(utcIso, rules, hourOffset) {
  const arr = Array.isArray(rules) ? rules : [];
  if (arr.length === 0) return 0;
  const hhmm = getHHMMWithHourOffset(utcIso, hourOffset);
  const nowMin = hhmmToMinutes(hhmm);

  let fallback = 0;
  for (const r of arr) {
    if (!r || typeof r.add !== 'number') continue;
    if (!r.from && !r.to) { fallback = r.add; continue; }
    const start = hhmmToMinutes(r.from || '00:00');
    const end = hhmmToMinutes(r.to || '00:00');
    if (start === end) { fallback = r.add; continue; }
    if (start < end) {
      if (nowMin >= start && nowMin < end) return r.add;
    } else {
      if (nowMin >= start || nowMin < end) return r.add;
    }
  }
  return fallback;
}

function selectGridAddSubunitNow(rules) {
  const arr = Array.isArray(rules) ? rules : [{ add: 0.00 }];
  const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const hhmm = fmt.format(new Date());
  const nowMin = hhmmToMinutes(hhmm);

  let fallback = 0;
  for (const r of arr) {
    const add = Number(r?.add) || 0;
    if (!r.from && !r.to) { fallback = add; continue; }
    const start = hhmmToMinutes(r.from || '00:00');
    const end = hhmmToMinutes(r.to || '00:00');
    if (start === end) { fallback = add; continue; }
    if (start < end) {
      if (nowMin >= start && nowMin < end) return add;
    } else {
      if (nowMin >= start || nowMin < end) return add;
    }
  }
  return fallback;
}

module.exports = NodeHelper.create({

  socketNotificationReceived: function (notification, payload) {
    if (notification === 'GET_PRICEDATA') {
      this.getPriceData(payload);
    }
  },

  async getPriceData(payload) {
    try {
      const [jsonToday, jsonYesterday] = await Promise.all([
        getJsonWithRetry(payload.urlToday, 2, DEFAULT_TIMEOUT_MS),
        getJsonWithRetry(payload.urlYesterday, 2, DEFAULT_TIMEOUT_MS),
      ]);

      const combinedData = {
        multiAreaEntries: [
          ...((jsonYesterday && jsonYesterday.multiAreaEntries) || []),
          ...((jsonToday && jsonToday.multiAreaEntries) || []),
        ],
      };

      if (payload.urlTomorrow) {
        try {
          const jsonTomorrow = await getJsonWithRetry(payload.urlTomorrow, 2, DEFAULT_TIMEOUT_MS);
          combinedData.multiAreaEntries.push(
            ...((jsonTomorrow && jsonTomorrow.multiAreaEntries) || []),
          );
        } catch (e) {
          console.warn('Tomorrow fetch failed (continuing without it):', e.message);
        }
      }

      const { quarter, hour } = this.parsePriceData(combinedData, payload);
      const gridAddSubunit = selectGridAddSubunitNow(payload.gridPriceRules);
      this.sendSocketNotification('PRICEDATA', {
        priceDataQuarter: quarter,
        priceDataHour: hour,
        gridAddSubunit,
      });

    } catch (e) {
      console.error('Fetching price data failed:', e.message);
      this.sendSocketNotification('PRICEDATAERROR', e.message);
    }
  },

  parsePriceData(data, payload) {
    const ret = [];

    if (!payload.validDataSources.includes(payload.dataSource)) {
      return [];
    }
    if (!data) return [];
    if (!data.multiAreaEntries) return [];

    const hourOffset = (typeof payload.hourOffset === 'number')
      ? payload.hourOffset
      : (-new Date().getTimezoneOffset() / 60);

    const priceMultiplier = (typeof payload.priceMultiplier === 'number') ? payload.priceMultiplier : 1;
    const priceOffset = (typeof payload.priceOffset === 'number') ? payload.priceOffset : 0; // currency/kWh
    const gridPriceRules = Array.isArray(payload.gridPriceRules) ? payload.gridPriceRules : [{ add: 0.00 }];
    // support settings
    const supportThreshold = (typeof payload.supportThreshold === 'number') ? payload.supportThreshold : 0.70; // currency/kWh
    const supportPercent = (typeof payload.supportPercent === 'number') ? payload.supportPercent : 0.90; // 0..1

    for (const entry of data.multiAreaEntries) {
      const areaData = entry.entryPerArea?.[payload.dataSource];
      if (typeof areaData !== 'number') continue;

      // grid as currency/kWh
      const addSubunit = computeGridPriceAdderSubunit(entry.deliveryStart, gridPriceRules, hourOffset);
      const gridKWh = (addSubunit / 100); // "cent"->currency per kWh

      const energyKWh = (areaData / 1000) * priceMultiplier; // raw -> currency/kWh
      const priceKWh = energyKWh + priceOffset + gridKWh;

      // support applies to energy component above threshold
      const compensatedEnergyKWh = energyKWh - (supportPercent * Math.max(0, energyKWh - supportThreshold));
      const supportPriceKWh = compensatedEnergyKWh + priceOffset + gridKWh;

      const dt = new Date(entry.deliveryStart);
      dt.setTime(dt.getTime() + hourOffset * 60 * 60 * 1000);
      const offsetDate = `${dt.getFullYear()}-${(`0${  dt.getMonth() + 1}`).slice(-2)}-${(`0${  dt.getDate()}`).slice(-2)}`;
      const offsetTime = `${(`0${  dt.getHours()}`).slice(-2)}:${(`0${  dt.getMinutes()}`).slice(-2)}:00`;

      ret.push({
        date: offsetDate,
        time: offsetTime,
        value: priceKWh,              // base price (no support), currency/kWh
        supportValue: supportPriceKWh,// with strømstøtte, currency/kWh
        rawMWh: areaData,             // currency/MWh
        utc: entry.deliveryStart,
      });
    }

    ret.sort((a, b) => {
      const ka = `${a.date} ${a.time}`;
      const kb = `${b.date} ${b.time}`;
      return ka.localeCompare(kb);
    });


    const hourBuckets = new Map(); // key: "YYYY-MM-DD HH:00"
    const order = [];

    for (const p of ret) {
      const hh = p.time.slice(0, 2);
      const key = `${p.date} ${hh}:00`;
      if (!hourBuckets.has(key)) {
        hourBuckets.set(key, { sumRaw: 0, n: 0, firstUtc: p.utc, date: p.date, time: `${hh}:00:00` });
        order.push(key);
      }
      const b = hourBuckets.get(key);
      if (typeof p.rawMWh === 'number') {
        b.sumRaw += p.rawMWh;
        b.n += 1;
      }
    }

    const hour = [];
    for (const key of order) {
      const b = hourBuckets.get(key);
      const avgRawMWh = b.n > 0 ? (b.sumRaw / b.n) : 0;

      const gridSubunit = computeGridPriceAdderSubunit(b.firstUtc, gridPriceRules, hourOffset);
      const gridKWh = gridSubunit / 100;

      const energyKWhHour = (avgRawMWh / 1000) * priceMultiplier;
      const priceKWhHour = energyKWhHour + priceOffset + gridKWh;

      const compensatedEnergyHour = energyKWhHour - (supportPercent * Math.max(0, energyKWhHour - supportThreshold));
      const supportPriceKWhHour = compensatedEnergyHour + priceOffset + gridKWh;

      hour.push({
        date: b.date,
        time: b.time,
        value: priceKWhHour,
        supportValue: supportPriceKWhHour,
      });
    }

    return { quarter: ret, hour };

  },

});
