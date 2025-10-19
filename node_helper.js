/* Magic Mirror
 * Module: MMM-EUElectricityPrice
 *
 * By late4marshmellow a fork from JanneKalliola (MMM-FiElectricityPrice)
 *
 */
const NodeHelper = require('node_helper');
const https = require('https');

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
			req.on('error', (e) => {
				return n > 0
					? setTimeout(() => attempt(n - 1), 500 * (retries - n + 1))
					: reject(e);
			});
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
		const end   = hhmmToMinutes(r.to   || '00:00');
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
		const end   = hhmmToMinutes(r.to   || '00:00');
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
				getJsonWithRetry(payload.urlYesterday, 2, DEFAULT_TIMEOUT_MS)
			]);

			let combinedData = {
				multiAreaEntries: [
					...((jsonYesterday && jsonYesterday.multiAreaEntries) || []),
					...((jsonToday && jsonToday.multiAreaEntries) || [])
				]
			};

			if (payload.urlTomorrow) {
				try {
					const jsonTomorrow = await getJsonWithRetry(payload.urlTomorrow, 2, DEFAULT_TIMEOUT_MS);
					combinedData.multiAreaEntries.push(
						...((jsonTomorrow && jsonTomorrow.multiAreaEntries) || [])
					);
				} catch (e) {
					console.warn('Tomorrow fetch failed (continuing without it):', e.message);
				}
			}

			const ret = this.parsePriceData(combinedData, payload);
			const gridAddSubunit = selectGridAddSubunitNow(payload.gridPriceRules);
			this.sendSocketNotification('PRICEDATA', {
				priceData: ret,
				gridAddSubunit
			});
		} catch (e) {
			console.error('Fetching price data failed:', e.message);
			this.sendSocketNotification('PRICEDATAERROR', e.message);
		}
	},

	parsePriceData(data, payload) {
		let ret = [];

		if (!payload.validDataSources.includes(payload.dataSource)) {
			return [];
		}
		if (!data) return [];
		if (!data.multiAreaEntries) return [];

		const hourOffset = (typeof payload.hourOffset === 'number')
			? payload.hourOffset
			: (-new Date().getTimezoneOffset() / 60);

		const priceMultiplier = (typeof payload.priceMultiplier === 'number') ? payload.priceMultiplier : 1;
		const priceOffset = (typeof payload.priceOffset === 'number') ? payload.priceOffset * 1000 : 0;
		const gridPriceRules = Array.isArray(payload.gridPriceRules) ? payload.gridPriceRules : [{ add: 0.00 }];

		for (const entry of data.multiAreaEntries) {
			const areaData = entry.entryPerArea?.[payload.dataSource];
			if (typeof areaData !== 'number') continue;

			const addSubunit = computeGridPriceAdderSubunit(entry.deliveryStart, gridPriceRules, hourOffset);
			const addStored  = (addSubunit / 100) * 1000;
			const price = (areaData * priceMultiplier) + priceOffset + addStored;

			const dt = new Date(entry.deliveryStart);
			dt.setTime(dt.getTime() + hourOffset * 60 * 60 * 1000);
			const offsetDate = `${dt.getFullYear()}-${("0" + (dt.getMonth() + 1)).slice(-2)}-${("0" + dt.getDate()).slice(-2)}`;
			const offsetTime = `${("0" + dt.getHours()).slice(-2)}:${("0" + dt.getMinutes()).slice(-2)}:00`;

			ret.push({ date: offsetDate, time: offsetTime, value: price });
		}

		ret.sort((a, b) => {
			const ka = `${a.date} ${a.time}`;
			const kb = `${b.date} ${b.time}`;
			return ka.localeCompare(kb);
		});

		return ret;
	}

});
