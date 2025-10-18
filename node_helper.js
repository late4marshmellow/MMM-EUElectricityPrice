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
					res.resume(); // drain
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


module.exports = NodeHelper.create({



	socketNotificationReceived: function (notification, payload) {
		if (notification === 'GET_PRICEDATA') {
			this.getPriceData(payload);
		}
	},

	/**
	 * Parses the loaded price data to simplify processing on the 
	 * front-end.
	 *
	 * @param {Object} data - The price data.
	 * @param {Object} payload - An object containing configuration and additional data.
	 *    @property {Int} hourOffset - The local time offset from CET/CEST.
	 *    @property {Double} [priceOffset=0] - The offset to be added on top of the price.
	 *    @property {Double} [priceMultiplier=1] - The multiplier of the price. The price will be multiplied first and then offset is added.
	 * @return {Object} The parsed price data or false, if an error occurred.
	 */

	async getPriceData(payload) {
		console.log('getpricedata');
		try {
			// Always fetch today + yesterday (in parallel)
			const [jsonToday, jsonYesterday] = await Promise.all([
				getJsonWithRetry(payload.urlToday, 2, DEFAULT_TIMEOUT_MS),
				getJsonWithRetry(payload.urlYesterday, 2, DEFAULT_TIMEOUT_MS)
			]);

			// Combine safely even if a field is missing
			let combinedData = {
				multiAreaEntries: [
					...((jsonYesterday && jsonYesterday.multiAreaEntries) || []),
					...((jsonToday && jsonToday.multiAreaEntries) || [])
				]
			};

			// After publish time, try tomorrow as well; proceed even if it fails
			//const now = new Date();
			//if (now.getHours() >= payload.tomorrowDataTime && payload.urlTomorrow) {
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

			console.log(`Processing ${combinedData.multiAreaEntries.length} entries`);
			this.processAndSendData(combinedData, payload);
		} catch (e) {
			console.error('Fetching price data failed:', e.message);
			this.sendSocketNotification('PRICEDATAERROR', e.message);
		}
	},


	processAndSendData(data, payload) {
		const list = Array.isArray(data?.multiAreaEntries) ? data.multiAreaEntries : [];
		if (list.length === 0) {
			this.sendSocketNotification('PRICEDATAERROR', 'No entries received from API');
			return;
		}
		const ret = this.parsePriceData({ multiAreaEntries: list }, payload);
		if (!Array.isArray(ret) || ret.length === 0) {
			this.sendSocketNotification('PRICEDATAERROR', 'Parsed dataset is empty');
		} else {
			this.sendSocketNotification('PRICEDATA', ret);
		}
	},


	/**
	 * Parses the loaded price data to simplify processing on the front-end.
	 *
	 * @param {Object} data - The raw price data to be parsed.
	 * @param {Object} payload - An object containing configuration and additional data for parsing.
	 *    @property {Int} hourOffset - The local time offset from CET/CEST.
	 *    @property {Double} [priceOffset=0] - The offset to be added on top of the price.
	 *    @property {Double} [priceMultiplier=1] - The multiplier of the price. The price will be multiplied first and then offset is added.
	 *    @property {String} dataSource - Identifier for the desired data source.
	 *    @property {Array} validDataSources - List of valid data sources.
	 * @return {Object|Array} The parsed price data, an array of processed data, or an error object if an issue occurs.
	 */
	parsePriceData(data, payload) {
		console.log('Start dataparse');
		let ret = [];

		if (!payload.validDataSources.includes(payload.dataSource)) {
			return { error: "Invalid data source." };
		}
		if (!data) return { error: "Data is missing." };
		if (!data.multiAreaEntries) return { error: "multiAreaEntries is missing." };

		// Normalize config
		const hourOffset = (typeof payload.hourOffset === 'number') ? payload.hourOffset : 0;
		const priceMultiplier = (typeof payload.priceMultiplier === 'number') ? payload.priceMultiplier : 1;
		const priceOffset = (typeof payload.priceOffset === 'number') ? payload.priceOffset * 1000 : 0;

		// Build rows
		for (const entry of data.multiAreaEntries) {
			const areaData = entry.entryPerArea?.[payload.dataSource];
			if (typeof areaData !== 'number') continue;

			// price = (value * multiplier) + offset
			const price = (areaData * priceMultiplier) + priceOffset;

			// deliveryStart is ISO from Nord Pool; treat it as UTC then add hourOffset
			const dt = new Date(entry.deliveryStart);
			dt.setTime(dt.getTime() + hourOffset * 60 * 60 * 1000);

			const offsetDate = `${dt.getFullYear()}-${("0" + (dt.getMonth() + 1)).slice(-2)}-${("0" + dt.getDate()).slice(-2)}`;
			const offsetTime = `${("0" + dt.getHours()).slice(-2)}:${("0" + dt.getMinutes()).slice(-2)}:00`;

			ret.push({
				date: offsetDate,
				time: offsetTime,
				value: price
			});
		}

		// Ensure chronological order (earliest → latest)
		// String sort on ISO-like "YYYY-MM-DD HH:MM:SS" is safe and fast
		ret.sort((a, b) => {
			const ka = `${a.date} ${a.time}`;
			const kb = `${b.date} ${b.time}`;
			return ka.localeCompare(kb);
		});

		return ret;
	},


});