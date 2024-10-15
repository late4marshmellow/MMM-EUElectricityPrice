/* Magic Mirror
 * Module: MMM-FiElectricityPrice
 *
 * By JanneKalliola (MMM-FiElectricityPrice), Forked by late4marshmellow
 *
 */
const NodeHelper = require('node_helper');
const https = require('https');

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

	getPriceData(payload) {
		console.log('getpricedata');

		// Fetch data for today
		https.get(payload.url, (res) => {
			let body = '';

			res.on('data', (chunk) => {
				body += chunk;
			});

			res.on('end', () => {
				let jsonToday = JSON.parse(body);

				// If the current hour is tomorrowDataTime or later, and urlTomorrow is "truthy" also fetch data from urlTomorrow 
				let currentHour = new Date().getHours();
				if (currentHour >= payload.tomorrowDataTime && payload.urlTomorrow) {
					https.get(payload.urlTomorrow, (resTomorrow) => {
						let bodyTomorrow = '';

						resTomorrow.on('data', (chunk) => {
							bodyTomorrow += chunk;
						});

						resTomorrow.on('end', () => {
							let jsonTomorrow = JSON.parse(bodyTomorrow);

							// Combine jsonToday and jsonTomorrow
							let combinedData = {
								data: {
									multiAreaEntries: [...jsonToday.data.multiAreaEntries, ...jsonTomorrow.data.multiAreaEntries]
								}
							};

							this.processAndSendData(combinedData, payload);
						});
					}).on('error', (e) => {
						console.error(`Got error: ${e.message}`);
					});
				} else {
					this.processAndSendData(jsonToday, payload);
				}
			});
		}).on('error', (e) => {
			console.error(`Got error: ${e.message}`);
		});
	},

	processAndSendData(data, payload) {
		let ret = this.parsePriceData(data, payload);
		if (ret === false) {
			this.sendSocketNotification('PRICEDATAERROR', 'ret = false');
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

		if (payload.validDataSources.includes(payload.dataSource)) {
			console.log(payload.dataSource, ' dataparse');
			if (!data) {
				return { error: "Data is missing." };
			}

			if (!data.multiAreaEntries) {
				return { error: "multiAreaEntries is missing." };
			}
			if (!payload.hourOffset) {
				payload.hourOffset = 0;
			}
			if (!payload.priceOffset) {
				payload.priceOffset = 0;
			} else {
				payload.priceOffset = payload.priceOffset * 1000;
			}
			if (!payload.priceMultiplier) {
				payload.priceMultiplier = 1;
			}

			// Loop through each entry in the multiAreaEntries
			for (let entry of data.multiAreaEntries) {
				// Fetch the price for the specified area (e.g., NO1)
				let areaData = entry.entryPerArea[payload.dataSource];
				if (areaData) {
					// Calculate the price with multiplier and offset
					let price = (areaData * payload.priceMultiplier) + payload.priceOffset;

					// Offset the hours to match the local time
					let dt = new Date(entry.deliveryStart);
					dt.setTime(dt.getTime() + payload.hourOffset * 60 * 60 * 1000);

					// Format the date and time
					let offsetDate = `${dt.getFullYear()}-${("0" + (dt.getMonth() + 1)).slice(-2)}-${("0" + dt.getDate()).slice(-2)}`;
					let offsetTime = `${("0" + dt.getHours()).slice(-2)}:00:00`;

					// Construct the result row
					let retRow = {
						date: offsetDate,
						time: offsetTime,
						value: price
					};
					ret.push(retRow); // Change from unshift to push to maintain ascending order
				}
			}
		} else {
			return { error: "Invalid data source." };
		}
		return ret;
	},

	processData: function(response, payload) {
		let ret = [];
		let data = response.data;

		if (data && data.multiAreaEntries) {
			// Merge today's and tomorrow's data
			let mergedEntries = data.multiAreaEntries;

			// Iterate over the merged entries
			for (let entry of mergedEntries) {
				// Fetch the price for the specified area (e.g., NO1)
				let areaData = entry.entryPerArea[payload.dataSource];
				if (areaData) {
					// Calculate the price with multiplier and offset
					let price = (areaData * payload.priceMultiplier) + payload.priceOffset;

					// Offset the hours to match the local time
					let dt = new Date(entry.deliveryStart);
					dt.setTime(dt.getTime() + payload.hourOffset * 60 * 60 * 1000);

					// Format the date and time
					let offsetDate = `${dt.getFullYear()}-${("0" + (dt.getMonth() + 1)).slice(-2)}-${("0" + dt.getDate()).slice(-2)}`;
					let offsetTime = `${("0" + dt.getHours()).slice(-2)}:00:00`;

					// Construct the result row
					let retRow = {
						date: offsetDate,
						time: offsetTime,
						value: price
					};
					ret.push(retRow); // Change from push to unshift to maintain descending order
				}
			}
		} else {
			return { error: "Invalid data source." };
		}
		return ret;
	}
});