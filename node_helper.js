/* Magic Mirror
 * Module: MMM-FiElectricityPrice
 *
 * By JanneKalliola
 *
 */
const NodeHelper = require('node_helper');
const https = require('https');

module.exports = NodeHelper.create({

	

	socketNotificationReceived: function(notification, payload) {
        if(notification === 'GET_PRICEDATA') {
            this.getPriceData(payload.url, payload.hourOffset, payload.priceOffset, payload.priceMultiplier);
        }
	},

	/**
	 * Fetch price data from the given URL and parse it. When parsing is
	 * done, the function sends notification back to the front-end with the
	 * data or an error.
	 *
	 * @param String url The URL
	 * @param Int hourOffset The local time offset from CET/CEST.
	 * @param Double priceOffset The offset to be added on top of the price.
	 * @param Double priceMultiplier The multiplier of the price. The price will be multiplied first and then offset is added.
	 */
	getPriceData(url, hourOffset, priceOffset, priceMultiplier, dataSource) {
		console.log('getpricedata')
		https.get(url, (res) => {
			let body = '';

			res.on('data', (chunk) => {
				body += chunk;
			});

			res.on('end', () => {
				try {
					let json = JSON.parse(body);
					let ret = this.parsePriceData(json, hourOffset, priceOffset, priceMultiplier, dataSource);
					if(ret === false) {
						this.sendSocketNotification('PRICEDATAERROR', 'ret = false');
					}
					else {
						this.sendSocketNotification('PRICEDATA', ret);
					}
				} catch (error) {
					this.sendSocketNotification('PRICEDATAERROR', error);
				};
			});

		}).on('error', (error) => {
			this.sendSocketNotification('PRICEDATAERROR', '.on');
		});
	
	},

	/**
	 * Parses the loaded price data to simplify processing on the 
     * front-end.
	 *
	 * @param Object The price data.
	 * @param Int hourOffset The local time offset from CET/CEST.
	 * @param Double priceOffset The offset to be added on top of the price.
	 * @param Double priceMultiplier The multiplier of the price. The price will be multiplied first and then offset is added.
	 * @return Object The parsed price data or false, if an error
	 * occurred.
	 */
	parsePriceData(data, hourOffset, priceOffset, priceMultiplier, dataSource) {
		console.log('doing dataparse');
		let ret = [];
	
		if (dataSource === "Oslo") {
			console.log('oslo dataparse');
	
			// Loop through each row in the data
			for (let row of data.data.Rows) {
				const cleanedName = row.Name.replace(/&nbsp;/g, ' ');
			
				if (!/^(\d{2} - \d{2})$/.test(cleanedName)) {
					continue; 
				}
			
				const osloData = row.Columns.find(column => column.Name === "Oslo");
			
				if (osloData) {
					// Calculate price in euro cents per MWh
					const price = parseInt(osloData.Value.replace(',', '.'), 10); // * priceMultiplier + priceOffset;
					//const price_kWh = value / 1000;
			
					// Offset the hours to match the local time
					let dt = new Date(row.StartTime);
					dt.setTime(dt.getTime() + hourOffset * 60 * 60 * 1000);
			
					let offsetDate = "" + dt.getFullYear() + '-' +
						("0" + (dt.getMonth() + 1)).slice(-2) + '-' +
						("0" + dt.getDate()).slice(-2);
					let offsetTime = ("0" + dt.getHours()).slice(-2) + ':00:00';
			
					ret.push({
						date: offsetDate,
						time: offsetTime,
						value: price // _kWh
					});
				}
			}
			} else {
		console.log('finnish data parse')
		if(!data) {
			return false;
		}

		if(!data['data'] || !data['data']['Rows']) {
			return false;
		}
		if(!hourOffset) {
			hourOffset = 0;
		}
		if(!priceOffset) {
			priceOffset = 0;
		}
		else {
			priceOffset = priceOffset * 1000;
		}
		if(!priceMultiplier) {
			priceMultiplier = 0;
		}
		data = data['data']['Rows'];
		//let ret = [];
		for(let j = 0; j < 7; j++) {
			for(let i = 23; i >= 0; i--) {
				let row = data[i];
				let priceTime = row['StartTime'].substring(11);
				if(row['Columns']) {
					let dp = row['Columns'][j];
					
					// Calculate price in euro cents per MWh
					let value = parseInt(dp['Value'].replace(',', ''), 10) * priceMultiplier + priceOffset;
					let dtold = dp['Name'].substring(6, 10) + '-' + dp['Name'].substring(3, 5) + '-' + dp['Name'].substring(0, 2);

					// Offset the hours to match the local time (Nord Pool hours are in CET/CEST)
					let dt = new Date(parseInt(dp['Name'].substring(6, 10), 10),
									  parseInt(dp['Name'].substring(3, 5), 10) - 1,
									  parseInt(dp['Name'].substring(0, 2), 10),
									  parseInt(priceTime.substring(0, 2), 10), 0, 0);

					dt.setTime(dt.getTime() + hourOffset * 60 * 60 * 1000);

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
