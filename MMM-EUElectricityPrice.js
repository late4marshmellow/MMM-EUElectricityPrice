/* Magic Mirror
 * Module: MMM-EUElectricityPrice
 *
 * By JanneKalliola (MMM-FiElectricityPrice), Forked By late4marshmellow
 *
 */


Module.register("MMM-EUElectricityPrice", {
	validDataSources: ['Oslo', 'Kr.sand', 'Bergen', 'Molde', 'Tromsø', 'SE1', 'SE2', 'SE3', 'SE4', 'FI', 'DK1', 'DK2', 'EE', 'LV', 'LT', 'AT', 'BE', 'DE-LU', 'FR', 'NL'],
	defaults: {
		dataSource: 'Oslo', //string, valid sources https://www.nordpoolgroup.com/en/Market-data1/Dayahead/Area-Prices/ALL1/Hourly/?view=table
		currency: 'NOK', // NOK, SEK, EUR, DKK
		centName: 'øre', //øre, cents 
		headText: 'Electricity Price', //string, header text
		tomorrowDataTime: 13, //integrer, time, HH (24H) when data should be available nextday. Default for CET/CEST is 13
		tomorrowDataTimeMinute: 1, //integrer, default should be 1
		errorMessage: 'Data could not be fetched.',
		loadingMessage: 'Loading data...',
		showPastHours: 24,
		showFutureHours: 36,
		hourOffset: 1,
		priceOffset: 0, // any extra costs added. in cents
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
		futureColor: 'rgba(255, 255, 255, 0.8)',
		futureBg: 'rgba(255, 255, 255, 0.6)',
		alertLimit: false,
		alertColor: 'rgba(255, 0, 0, 1)',
		alertBg: 'rgba(255, 0,0, 0.8)',
		safeLimit: false,
		safeColor: 'rgba(0, 255, 0, 1)',
		safeBg: 'rgba(0, 255,0, 0.8)',
		//line chart only
		borderWidthLine: 3, //integer, 1-10 (1 is thin, 10 is thick) sets the thickness of the line chart
		pointRegular: 4, //integer, 1-10 (1 is small, 10 is big) sets the size of the points in the line chart
		pointCurrent: 10, //integer, 1-10 (1 is small, 10 is big) sets the size of the current point in the line chart
		//bar chart only
		//Other
		tickInterval: false,
		updateUIInterval: 5 * 60 // #(minute) * 60
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
		let url;
		let urlTomorrow;
		let currency;
		let today = new Date();
		let formattedToday = `${today.getDate()}-${today.getMonth() + 1}-${today.getFullYear()}`;

		let tomorrow = new Date();
		tomorrow.setDate(today.getDate() + 1);
		let formattedTomorrow = `${tomorrow.getDate()}-${tomorrow.getMonth() + 1}-${tomorrow.getFullYear()}`;

		if (this.config.dataSource === 'SE3') {
			currency = 'SEK'
		} else if (this.config.dataSource === 'Oslo') {
			currency = 'NOK'
		} else {
			currency = 'EUR'
		}
		if (this.validDataSources.includes(this.config.dataSource)) {
			url = `https://www.nordpoolgroup.com/api/marketdata/page/10?currency=${currency}&endDate=${formattedToday}`;
			urlTomorrow = `https://www.nordpoolgroup.com/api/marketdata/page/10?currency=${currency}&endDate=${formattedTomorrow}`;
		} else if (this.config.dataSource === "Finnish") {
			url = "https://www.nordpoolgroup.com/api/marketdata/page/35?currency=EUR";
		}
		console.log("passing on ", url)
		if (urlTomorrow) {
			console.log("passing on ", urlTomorrow)
		}
		this.sendSocketNotification('GET_PRICEDATA', {
			url: url,
			urlTomorrow: urlTomorrow,
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
			console.log("Error:", payload);//delete
			this.setError();
		}
		this.updateDom();
	},

	setError: function () {
		this.error = true;
		this.priceData = false;
		setTimeout(this.schedulePriceUpdate, 30 * 60 * 1000);
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

			wrapper.innerHTML = this.config.errorMessage;
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
			if (this.config.showFutureHours !== false) {
				futureMark = Math.max(currentHourMark - this.config.showFutureHours, 0);
			}
			if (this.config.showPastHours !== false) {
				pastMark = Math.min(currentHourMark + this.config.showPastHours, this.priceData.length - 1);
			}

			let showData = [];
			let showAverage = [];
			let showLabel = [];
			let showColor = [];
			let showBg = [];
			let alertLimit = false;
			let safeLimit = false;
			if (this.config.alertLimit !== false) {
				if (this.config.alertLimit == 'average') {
					alertLimit = this.priceMetadata['average'];
				}
				else {
					alertLimit = this.config.alertLimit * 1000;
				}
			}
			if (this.config.safeLimit !== false) {
				if (this.config.safeLimit == 'average') {
					safeLimit = this.priceMetadata['average'];
				}
				else {
					safeLimit = this.config.safeLimit * 1000;
				}
			}

			for (let i = pastMark; i >= futureMark; i--) {
				showData.push(this.priceData[i].value / 1000);
				if (this.priceData[i].time[0] == '0') {
					showLabel.push(this.priceData[i].time.substring(1, 5));
				}
				else {
					showLabel.push(this.priceData[i].time.substring(0, 5));
				}
				showAverage.push(this.priceMetadata['average'] / 1000);
				if (i > currentHourMark) {
					showColor.push(this.config.pastColor);
					showBg.push(this.config.pastBg);
				}
				else if (alertLimit !== false && this.priceData[i].value > alertLimit) {
					showColor.push(this.config.alertColor);
					showBg.push(this.config.alertBg);
				}
				else if (safeLimit !== false && this.priceData[i].value < safeLimit) {
					showColor.push(this.config.safeColor);
					showBg.push(this.config.safeBg);
				}
				else if (i < currentHourMark) {
					showColor.push(this.config.futureColor);
					showBg.push(this.config.futureBg);
				}
				else {
					showColor.push(this.config.currentColor);
					showBg.push(this.config.currentBg);
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
			let borderWidth = (this.config.chartType === 'line') ? this.config.borderWidthLine : 1;

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
							beginAtZero: true,
							ticks: {
								color: this.config.labelColor
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
	<span style="font-size: 1.2em; font-weight: bold;">${this.config.headText}</span><br>
	<span style="font-size: 0.8em;">Now: </span>
        <span style="font-size: 1.2em; font-weight: bold;">${currentValue}</span>
        <span style="font-size: 0.8em;"> ${this.config.currency} ${this.config.centName}/kWh</span>
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
