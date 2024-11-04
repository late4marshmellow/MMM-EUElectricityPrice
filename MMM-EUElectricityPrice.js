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
		dataSource: 'NO1', //string, valid sources https://data.nordpoolgroup.com/auction/day-ahead/prices?deliveryDate=latest&currency=EUR&aggregation=Hourly&deliveryAreas=EE,LT,LV,AT,BE,FR,GER,NL,PL,DK1,DK2,FI,NO1,NO2,NO3,NO4,NO5,SE1,SE2,SE3,SE4
		currency: 'NOK', // NOK, SEK, DKK, PLN, EUR
		centName: 'øre', //e.g "øre" or "cents"
		headText: 'Electricity Price', //string, header text
		customText: '', //string, custom text
		showCurrency: true, //boolean, true or false, if true currency is shown after the headText
		tomorrowDataTime: 13, //integrer, time, HH (24H) when data should be available nextday. Default for CET/CEST is 13
		tomorrowDataTimeMinute: 1, //integrer, default should be 1
		errorMessage: 'Data could not be fetched.',
		loadingMessage: 'Loading data...',
		showPastHours: 24,
		showFutureHours: 36,
		hourOffset: 1,
		priceOffset: 0, // any extra costs added. in e.g 7 cents its written as 7, 0.07 is 7 cents
		priceMultiplier: 1, //add tax, (always minimum 1,  1 is 0% 1,25 is 25%)
		//module size and reposition
		width: null, //string, set to px e.g "600px"
		height: null, //sting, set to px eg. "600px"
		posRight: null, //string, px moves module left/right
		posDown: null, //sting, px moves module up/down
		//end module size and reposition
		chartType: 'bar', //string, line or bar
		showAverage: true,
		averageColor: '#fff',
		showGrid: true,
		gridColor: 'rgba(255, 255, 255, 0.3)',
		labelColor: '#fff',
		pastColor: 'rgba(255, 255, 255, 0.5)',
		pastBg: 'rgba(255, 255, 255, 0.3)',
		currentColor: '#fff',
		currentBg: '#fff',
		currentbgSwitch: false, //boolean, true or false, if true currentBg is used, if false color of current is used, e.g if safe/alert is on this will show
		futureColor: 'rgba(255, 255, 255, 0.8)',
		futureBg: 'rgba(255, 255, 255, 0.6)',
		alertLimit: false,
		alertValue: 100, // Set the alert threshold in cents per kWh
		alertColor: 'rgba(255, 0, 0, 1)',
		alertBg: 'rgba(255, 0,0, 0.8)',
		safeLimit: false,
		safeValue: 50, // Set the alert threshold in cents per kWh
		safeColor: 'rgba(0, 255, 0, 1)',
		safeBg: 'rgba(0, 255,0, 0.8)',
		beginAtZero: true, //boolean, true or false, if true the chart always contains the zero line, if false adjusted to active levels
		//line chart only
		borderWidthLine: 3, //integer, 1-10 (1 is thin, 10 is thick) sets the thickness of the line chart
		pointRegular: 4, //integer, 1-10 (1 is small, 10 is big) sets the size of the points in the line chart
		pointCurrent: 10, //integer, 1-10 (1 is small, 10 is big) sets the size of the current point in the line chart
		//bar chart only
		borderWidthBar: 1, //integer, 1-10 (1 is thin, 10 is thick) sets the thickness of the bar chart
		//Other
		tickInterval: false,
		updateUIInterval: 5 * 60, // #(minute) * 60
		yDecimals: 2 //integer, 0-2, sets the number of decimals on the y-axis
	},

	getScripts: function () {
		return [this.file('node_modules/chart.js/dist/chart.min.js')];
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

		this.getPriceData();
		let hour = this.config.tomorrowDataTime;
		let minute = this.config.tomorrowDataTimeMinute;
		let now = new Date();
		let updateMoment = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0).getTime() - now.getTime();
		if (updateMoment < 1000) {
			updateMoment += 86400000;
		}
		this.timeout = setTimeout(() => this.schedulePriceUpdate(), updateMoment);
	},

	scheduleUIUpdate: function () {
		var self = this;
		setInterval(() => {
			self.updateDom();
		}, this.config.updateUIInterval * 1000);
		this.updateDom();
	},

	getPriceData: function () {
		console.log('getPriceData');
		let currency = this.config.currency;

		let urlToday;
		let urlTomorrow;
		let urlYesterday;

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
		console.log("passing on ", urlToday)
		if (urlYesterday) {
			console.log("passing on ", urlYesterday)
		}

		if (urlTomorrow) {
			console.log("passing on ", urlTomorrow)
		}
		this.sendSocketNotification('GET_PRICEDATA', {
			urlToday: urlToday,
			urlTomorrow: urlTomorrow,
			urlYesterday: urlYesterday,
			tomorrowDataTime: this.config.tomorrowDataTime,
			hourOffset: this.config.hourOffset,
			priceOffset: this.config.priceOffset,
			priceMultiplier: this.config.priceMultiplier,
			dataSource: this.config.dataSource,
			validDataSources: this.validDataSources,
		});
	},

	socketNotificationReceived: function (notification, payload) {
		console.log('socketNotificationReceived');

		//console.log(notification, payload.jsonData) // delete this!
		//console.log(notification, payload) // delete this!

		if (notification === "PRICEDATA") {
			//console.log('pricedata ok')
			//console.log(payload)
			this.error = false;
			this.priceData = payload;
			if (this.priceData.length > 0) {
				let sum = 0;
				for (let i = 0; i < this.priceData.length; i++) {
					sum += this.priceData[i].value;
				}
				this.priceMetadata['average'] = sum / this.priceData.length;
			}
			else {
				this.priceMetadata['average'] = false;
			}
		}
		else if (notification === "PRICEDATAERROR") {
			console.log("Error:", payload);
			this.setError();
		}
		else if (notification === "INVALID_DATASOURCE") {
			console.log("Invalid data source:", payload);
			this.setError(payload);
			//this.error = true;
			//this.priceData = false;
			//this.errorMessage = payload;
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
		var wrapper = document.createElement("div");
		if (this.config.width) {
			wrapper.style.width = this.config.width;
			wrapper.style.transform = `translate(${this.config.posRight}, ${this.config.posDown})`;
		}

		if (this.config.height) {
			wrapper.style.height = this.config.height;
		}

		if (this.error) {

			wrapper.innerHTML = this.errorMessage || this.config.errorMessage;
			wrapper.className = 'dimmed light small';
			return wrapper;
		}

		if (this.priceData) {
			let now = new Date();
			let currentTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);

			// Change time to get local time from toISOString()
			currentTime = new Date(currentTime - currentTime.getTimezoneOffset() * 60000).toISOString();

			let currentDate = currentTime.substring(0, 10);
			currentTime = currentTime.substring(11, 19);

			let currentHourMark = false;
			for (let i = 0; i < this.priceData.length; i++) {
				if (this.priceData[i].date == currentDate &&
					this.priceData[i].time == currentTime) {
					currentHourMark = i;
					break;
				}
			}

			if (currentHourMark === false) {
				this.setError();
				wrapper.innerHTML = this.config.errorMessage;
				wrapper.className = 'dimmed light small';
				return wrapper;
			}

			let futureMark = 0;
			let pastMark = this.priceData.length - 1;
			
			// Calculate futureMark
			if (this.config.showFutureHours !== false) {
				futureMark = Math.max(currentHourMark - this.config.showFutureHours, 0);
			}
			
			// Calculate showPastHours dynamically if null
			let showPastHours = this.config.showPastHours;
			if (showPastHours === null) {
				showPastHours = this.config.totalHours - (currentHourMark - futureMark);
				showPastHours = Math.max(showPastHours, 0); // Ensure it's not negative
			}
			
			if (showPastHours !== false) {
				pastMark = Math.min(currentHourMark + showPastHours, this.priceData.length - 1);
			}
			
			let showData = [];
			let showAverage = [];
			let showLabel = [];
			let showColor = [];
			let showBg = [];
			let alertValue = null;
			let safeValue = null;
			if (this.config.alertLimit !== false) {
				if (this.config.alertValue == 'average') {
					alertValue = this.priceMetadata['average'];
				}
				else {
					alertValue = this.config.alertValue * 1000;
				}
			}
			if (this.config.safeLimit !== false) {
				if (this.config.safeValue == 'average') {
					safeValue = this.priceMetadata['average'];
				}
				else {
					safeValue = this.config.safeValue * 1000;
				}
			}

			for (let i = futureMark; i <= pastMark; i++) {
				// Extract value and time from the data
				const { value, time } = this.priceData[i];
			
				// Add normalized value to showData
				showData.unshift(value / 1000);
			
				// Handle label formatting and add to showLabel
				showLabel.unshift(time[0] === '0' ? time.substring(1, 5) : time.substring(0, 5));
			
				// Add normalized average to showAverage
				showAverage.unshift(this.priceMetadata['average'] / 1000);
			
				// Determine color and background based on conditions and add to respective arrays
				if (i === currentHourMark) {
					showColor.unshift(this.config.currentColor);
					if (this.config.currentbgSwitch) {
						showBg.unshift(this.config.currentBg);
					}
					else {
						showBg.unshift(this.config.futureBg);
					}
					//showBg.unshift(this.config.currentBg);
				}
				else if (i > currentHourMark) {
					showColor.unshift(this.config.pastColor);
					showBg.unshift(this.config.pastBg);
				}
				else if (this.config.alertLimit !== false && value > alertValue) {
					showColor.unshift(this.config.alertColor);
					showBg.unshift(this.config.alertBg);
				}
				else if (this.config.safeLimit !== false && value < safeValue) {
					showColor.unshift(this.config.safeColor);
					showBg.unshift(this.config.safeBg);
				}
				else {
					showColor.unshift(this.config.futureColor);
					showBg.unshift(this.config.futureBg);
				}
			}
			

			var chart = document.createElement("div");
			chart.className = 'small light';

			var canvas = document.createElement('canvas');

			let averageSet = {};
			if (this.config.showAverage) {
				averageSet = {
					type: 'line',
					label: 'Average',
					data: showAverage,
					color: this.config.averageColor,
					borderColor: this.config.averageColor,
					pointRadius: 0,
					order: 1,
					datalabels: {
						display: false
					}
				};
			}

			let gridConfig = {};
			if (this.config.showGrid) {
				gridConfig['display'] = true;
				gridConfig['color'] = this.config.gridColor;
			}
			else {
				gridConfig['display'] = false;
			}

			let self = this;
			let pointSizes = [];
			let borderWidth = (this.config.chartType === 'line') ? this.config.borderWidthLine : this.config.borderWidthBar;

			if (this.config.chartType === 'line') {
				//pointSizes = showData.map((_, idx) => idx === currentHourMark ? 10 : 2);
				pointSizes = showData.map((_, idx) => idx === (showData.length - 1 - currentHourMark) ? this.config.pointCurrent : this.config.pointRegular);

			}
			var myChart = new Chart(canvas, {
				type: this.config.chartType,
				data: {
					labels: showLabel,
					datasets: [{
						label: 'Cnt per kWh',
						type: this.config.chartType,
						data: showData,
						backgroundColor: showBg,
						borderColor: showColor,
						borderWidth: borderWidth,
						barPercentage: 0.75,
						order: 2,
						datalabels: {
							display: false
						}
					},
						averageSet]
				},
				options: {
					scales: {
						y: {
							grid: gridConfig,
							beginAtZero: this.config.beginAtZero,
							ticks: {
								color: this.config.labelColor,
								callback: function(value, index, values) {
									return value.toFixed(self.config.yDecimals); // Format y-axis labels to two decimal places
								}								
							}
						},
						x: {
							ticks: {
								color: this.config.labelColor,
								callback: function (value, index, ticks) {
									let val = this.getLabelForValue(value);
									if (self.config.tickInterval > 0) {
										let hour = val.split(':');
										hour = parseInt(hour[0]);
										if (hour % self.config.tickInterval == 0) {
											return val;
										}
										return null;
									}
									return val;
								}
							}
						}
					},
					animation: false,
					plugins: {
						legend: {
							display: false
						}
					}
				}
			});
			if (this.config.chartType === 'line') {
				myChart.data.datasets[0].pointRadius = pointSizes;
			}
    /*// Extracting Data for Display
    let currentValue = (this.priceData[currentHourMark].value / 1000).toFixed(2);
	let next24HoursData = this.priceData.slice(currentHourMark, currentHourMark + 24);
	let lowestValue = (Math.min(...next24HoursData.map(item => item.value)) / 1000).toFixed(2);
	let highestValue = (Math.max(...next24HoursData.map(item => item.value)) / 1000).toFixed(2);
	let todaysAverage = (this.priceMetadata['average'] / 1000).toFixed(2);
    */
	let currentValue = (this.priceData[currentHourMark].value / 1000).toFixed(2);

// Past 24 Hours Data
let past24HoursData = this.priceData.slice(Math.max(currentHourMark - 24, 0), currentHourMark);
let lowestValuePast24H = (Math.min(...past24HoursData.map(item => item.value)) / 1000).toFixed(2);
let highestValuePast24H = (Math.max(...past24HoursData.map(item => item.value)) / 1000).toFixed(2);

// Today's Average
let todaysAverage = (this.priceMetadata['average'] / 1000).toFixed(2);

    // Creating DOM Elements for Display
    var infoDiv = document.createElement("div");
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
			<span style="color: blue;">&darr;</span> ${lowestValuePast24H} ${this.config.centName}  
			<span style="color: #aaa;">&nbsp;&bull;&nbsp;</span> 
			<span style="color: red;">&uarr;</span> ${highestValuePast24H} ${this.config.centName} 
			<span style="color: #aaa;">&nbsp;&bull;&nbsp;</span> 
			≈ ${todaysAverage} ${this.config.centName}
		</span>
	</div>
`;
    // Append infoDiv before the chart
    wrapper.appendChild(infoDiv);

			chart.appendChild(canvas);
			wrapper.appendChild(chart);
			return wrapper;
		}

		wrapper.innerHTML = this.config.loadingMessage;
		wrapper.className = 'dimmed light small';
		return wrapper;
	}
});
