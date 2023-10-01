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

	//urlTomorrow, hourOffset, payload.priceOffset, payload.priceMultiplier, payload.dataSource, validDataSources//

/**
 * Parses the loaded price data to simplify processing on the 
 * front-end.
 *
 * @param {Object} data - The price data.
 * @param {Object} payload - An object containing configuration and additional data:
 *    - {Int} payload.hourOffset - The local time offset from CET/CEST.
 *    - {Double} [payload.priceOffset=0] - The offset to be added on top of the price.
 *    - {Double} [payload.priceMultiplier=1] - The multiplier of the price. The price will be multiplied first and then offset is added.
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
	
				// If the current hour is 13 (1 PM) or later, fetch data from urlTomorrow
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
									Rows: [...jsonToday.data.Rows, ...jsonTomorrow.data.Rows]
								}
							};
	
							this.processAndSendData(combinedData, payload);
						});
						
					}).on('error', (error) => {
						// Handle the error appropriately for tomorrow's data fetch
					});
				} else {
					this.processAndSendData(jsonToday, payload);
				}
			});
			
		}).on('error', (error) => {
			this.sendSocketNotification('PRICEDATAERROR', '.on');
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
	 * Parses the loaded price data to simplify processing on the 
	 * front-end.
	 *
	 * @param Object The price data.
	 * @param Int hourOffset The local time offset from CET/CEST.
	 * @param Double payload.priceOffset The offset to be added on top of the price.
	 * @param Double payload.priceMultiplier The multiplier of the price. The price will be multiplied first and then offset is added.
	 * @return Object The parsed price data or false, if an error
	 * occurred.
	 */
	parsePriceData(data, payload) {
		console.log('doing dataparse');
		let ret = [];

		if (payload.validDataSources.includes(payload.dataSource)) {
			console.log(payload.dataSource, ' dataparse');
			if (!data) {
				return { error: "Data is missing." };
			}

			if (!data['data'] || !data['data']['Rows']) {
				return { error: "data or data.Rows is missing." };
			}
			if (!payload.hourOffset) {
				payload.hourOffset = 0;
			}
			if (!payload.priceOffset) {
				payload.priceOffset = 0;
			}
			else {
				payload.priceOffset = payload.priceOffset * 1000;
			}
			if (!payload.priceMultiplier) {
				payload.priceMultiplier = 0;
			}

			// Loop through each row in the data
			for (let row of data.data.Rows) {
				// Clean the row's Name of any &nbsp; entities
				const cleanedName = row.Name.replace(/&nbsp;/g, ' ');

				// Check if the cleaned Name matches the pattern of hourly intervals
				if (!/^(\d{2} - \d{2})$/.test(cleanedName)) {
					continue; // Skip this row if it doesn't match the pattern
				}

				//const priceTime = row.StartTime.split("T")[1].substring(0, 2); // Extract the hour part
				const sourceData = row.Columns.find(column => column.Name === payload.dataSource);
				//console.log("Before accessing sourceData.Value:", sourceData);

				if (sourceData) {
					let price;
					if (sourceData && typeof sourceData.Value === 'string') {
						// Calculate price in cents per MWh
						price = ((parseFloat(sourceData.Value.replace(',', '.'), 10) + payload.priceOffset) * 100) * payload.priceMultiplier;
					} else {
						// Handle the error or set a default value for price
						price = 0; 
					}


					// Offset the hours to match the local time
					let dt = new Date(row.StartTime);
					dt.setTime(dt.getTime() + payload.hourOffset * 60 * 60 * 1000);

					let offsetDate = "" + dt.getFullYear() + '-' +
						("0" + (dt.getMonth() + 1)).slice(-2) + '-' +
						("0" + dt.getDate()).slice(-2);
					let offsetTime = ("0" + dt.getHours()).slice(-2) + ':00:00';

					let retRow = {
						date: offsetDate,
						time: offsetTime,
						value: price
					}
					ret.unshift(retRow);
				}
			}
			console.log(payload.dataSource, 'data OK') // delete
		} else {
			console.log('finnish data parse')
			if (!data) {
				return false;
			}

			if (!data['data'] || !data['data']['Rows']) {
				return false;
			}
			if (!payload.hourOffset) {
				payload.hourOffset = 0;
			}
			if (!payload.priceOffset) {
				payload.priceOffset = 0;
			}
			else {
				payload.priceOffset = payload.priceOffset * 1000;
			}
			if (!payload.priceMultiplier) {
				payload.priceMultiplier = 0;
			}
			data = data['data']['Rows'];
			//let ret = [];
			for (let j = 0; j < 7; j++) {
				for (let i = 23; i >= 0; i--) {
					let row = data[i];
					let priceTime = row['StartTime'].substring(11);
					if (row['Columns']) {
						let dp = row['Columns'][j];

						// Calculate price in euro cents per MWh
						let value = parseInt(dp['Value'].replace(',', ''), 10) * payload.priceMultiplier + payload.priceOffset;
						let dtold = dp['Name'].substring(6, 10) + '-' + dp['Name'].substring(3, 5) + '-' + dp['Name'].substring(0, 2);

						// Offset the hours to match the local time (Nord Pool hours are in CET/CEST)
						let dt = new Date(parseInt(dp['Name'].substring(6, 10), 10),
							parseInt(dp['Name'].substring(3, 5), 10) - 1,
							parseInt(dp['Name'].substring(0, 2), 10),
							parseInt(priceTime.substring(0, 2), 10), 0, 0);

						dt.setTime(dt.getTime() + payload.hourOffset * 60 * 60 * 1000);

						let offsetDate = "" + dt.getFullYear() + '-' +
							("0" + (dt.getMonth() + 1)).slice(-2) + '-' +
							("0" + dt.getDate()).slice(-2);
						let offsetTime = ("0" + dt.getHours()).slice(-2) + ':00:00';

						let retRow = {
							date: offsetDate,
							time: offsetTime,
							value: value,
						}
						ret.push(retRow);
					}
				}
			}
		}
		return ret;
	}
});