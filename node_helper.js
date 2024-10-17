/* Magic Mirror
 * Module: MMM-EUElectricityPrice
 *
 * By late4marshmellow a fork from JanneKalliola (MMM-FiElectricityPrice)
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
		https.get(payload.urlToday, (resToday) => {
			let bodyToday = '';

			resToday.on('data', (chunk) => {
				bodyToday += chunk;
			});

			resToday.on('end', () => {
				let jsonToday;
				try {
					jsonToday = JSON.parse(bodyToday);
				} catch (e) {
					console.error('Error parsing today\'s data:', e.message);
					return;
				}

				// Debugging: Log the structure of jsonToday
				//console.log('jsonToday:', JSON.stringify(jsonToday, null, 2));

				// Fetch data for yesterday	
				https.get(payload.urlYesterday, (resYesterday) => {
					let bodyYesterday = '';

					resYesterday.on('data', (chunk) => {
						bodyYesterday += chunk;
					});

					resYesterday.on('end', () => {
						let jsonYesterday;
						try {
							jsonYesterday = JSON.parse(bodyYesterday);
						} catch (e) {
							console.error('Error parsing tomorrow\'s data:', e.message);
							return;
						}
						// Fetch and combine today's and yesterday's data
						let combinedData = {
							multiAreaEntries: [...jsonYesterday.multiAreaEntries, ...jsonToday.multiAreaEntries]
						};

						// Debugging: Log the structure of jsonYesterday
						//console.log('jsonYesterday:', JSON.stringify(jsonYesterday, null, 2));

						// If the current hour is tomorrowDataTime or later, and urlTomorrow is "truthy" also fetch data from urlTomorrow 
						let currentHour = new Date().getHours();
						if (currentHour >= payload.tomorrowDataTime && payload.urlTomorrow) {
							https.get(payload.urlTomorrow, (resTomorrow) => {
								let bodyTomorrow = '';

								resTomorrow.on('data', (chunk) => {
									bodyTomorrow += chunk;
								});

								resTomorrow.on('end', () => {
									let jsonTomorrow;
									try {
										jsonTomorrow = JSON.parse(bodyTomorrow);
									} catch (e) {
										console.error('Error parsing tomorrow\'s data:', e.message);
										return;
									}

									// Debugging: Log the structure of jsonTomorrow
									//console.log('jsonTomorrow:', JSON.stringify(jsonTomorrow, null, 2));

									// Fetch and combine all data
									let combinedData = {
										multiAreaEntries: [...jsonYesterday.multiAreaEntries, ...jsonToday.multiAreaEntries, ...jsonTomorrow.multiAreaEntries]
									};

									// Debugging: Log the combined data of today and yesterday
									//console.log('combinedData (today + yesterday):', JSON.stringify(combinedData, null, 2));


									// Process and send the combined data
									console.log('Processing today, yesterday, and tomorrow\'s data');
									this.processAndSendData(combinedData, payload);
								});
							}).on('error', (e) => {
								console.error(`Got error: ${e.message}`);
							});
						} else {
							console.log('Processing today and yesterday\'s data only');
							this.processAndSendData(combinedData, payload);
						}
					});
				}).on('error', (e) => {
					console.error(`Got error: ${e.message}`);
				});
			});
		}).on('error', (e) => {
			console.error(`Got error: ${e.message}`);
		});
	},

	processAndSendData(data, payload) {
		// Debugging: Log the data and payload

		/*console.log('processAndSendData called with data:', JSON.stringify(data, null, 2));
		console.log('processAndSendData called with payload:', payload);
		console.log('Number of entries in data.multiAreaEntries:', data.multiAreaEntries.length);*/


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
			//console.log('Valid data source', payload.dataSource); // Debugging
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
					ret.unshift(retRow);
				}
			}
		} else {
			return { error: "Invalid data source." };
		}
		return ret;
	},

});