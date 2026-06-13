function getStats() {
	let stats = new Stats();
	stats.setMode(0);
	stats.domElement.style.position = "absolute";
	stats.domElement.style.left = "0px";
	stats.domElement.style.top = "0px";
	document.body.appendChild(stats.domElement);
	return stats;
}

let matrixPrint = function(A) {
	str = "";
	for (i = 0; i < A.length; i++) {
		str += `${A[i]}<br>`.replace(/([^\D0])/g, "<span class='oneHighlight'>$1</span>")
	}
	return str;
};

let getRow = (M, i) => math.flatten(M.subset(math.index(i, math.range(0, M._size[0])))).toArray();

let getCol = (M, i) => math.flatten(M.subset(math.index(math.range(0, M._size[0]), i))).toArray();

var Constellation = (function() {
	let canvas, context, config, paused = false,
		thresholdsVisible = true;
	let defaults = {
		star: {
			color: "rgba(255, 255, 255, .6)",
			radius: 1,
			randomRadius: false
		},
		line: {
			color: "rgba(255, 255, 255, .5)",
			width: 0.2
		},
		position: {
			x: 0, // This value will be overwritten at startup
			y: 0 // This value will be overwritten at startup
		},
		width: $("#canvasContainer").width(),
		height: $("#canvasContainer").height(),
		velocity: 0.1,
		numStars: 100,
		radius: 150,
		stars: []
	};

	let t = 0;

	let zeroSimplexes = 0,
		oneSimplexes = 0,
		twoSimplexes = 0,
		threeSimplexes = 0,
		xi = 0,
		numComponents = 0;

	let $0Simplexes, $1Simplexes, $2Simplexes, $3Simplexes,
		$eulerCharacteristic, $numComponents;

	let adjacencyMatrix, degreeMatrix, laplacian, edges = [];

	let thresholdColor = "rgba(255,255,255,0.05)";

	let Star = function(id) {
		this.id = id;
		this.neighbors = {};
		this.degree = 0;
		this.x = Math.random() * canvas.width;
		this.y = Math.random() * canvas.height;

		this.vx = config.velocity - Math.random() * 0.5;
		this.vy = config.velocity - Math.random() * 0.5;

		this.radius = config.star.randomRadius ?
			Math.random() * config.star.radius :
			config.star.radius;
	};

	Star.prototype = function() {

		let _drawCircle = function() {
			context.beginPath();
			context.fillStyle = thresholdColor;
			context.arc(this.x, this.y, config.linkThreshold, 0, Math.PI * 2, false);
			context.fill();
			context.closePath();
		};

		let _drawSelf = function() {
			context.beginPath();
			context.fillStyle = config.star.color;
			context.arc(this.x, this.y, this.radius, 0, Math.PI * 2, false);
			context.fill();
			context.closePath();
			// Draw ID
			context.fillStyle = "white";
			context.fillText(`${this.id}`, this.x - this.radius, this.y - this.radius);
		};

		let _connectTo = function(otherStar) {
			if (!this.isConnectedTo(otherStar)) {
				this.degree += 1;
				oneSimplexes += 1;
				this.neighbors[otherStar.id] = otherStar;
				// degreeMatrix.subset(math.index(this.id, this.id), this.degree);
				// adjacencyMatrix.subset(math.index(this.id, otherStar.id), 1);
				// adjacencyMatrix.subset(math.index(otherStar.id, this.id), 1);
				// laplacian = math.subtract(degreeMatrix, adjacencyMatrix);
			}
			context.beginPath();
			context.moveTo(this.x, this.y);
			context.lineTo(otherStar.x, otherStar.y);
			context.stroke();
			context.closePath();
		};

		let _disconnectFrom = function(otherStar) {
			if (this.isConnectedTo(otherStar)) {
				this.neighbors[otherStar.id] = null;
				this.degree -= 1;
				oneSimplexes -= 1;
				// degreeMatrix.subset(math.index(this.id, this.id), this.degree);
				// adjacencyMatrix.subset(math.index(this.id, otherStar.id), 0);
				// adjacencyMatrix.subset(math.index(otherStar.id, this.id), 0);
				// laplacian = math.subtract(degreeMatrix, adjacencyMatrix);
			}
		};

		let _isConnectedTo = function(otherStar) {
			return this.neighbors[otherStar.id] != null;
		};

		let _getNeighbors = function() {
			return this.neighbors.values(n).filter(i => i != null);
		};

		let _getNeighborIndices = function(A) {
			var a = getRow(adjacencyMatrix, this.id);
			var indices = [];
			var idx = a.indexOf(1);
			while (idx != -1) {
				indices.push(idx);
				idx = a.indexOf(1, idx + 1);
			}
			return indices;
		};

		let _checkCollision = function() {
			this.vy = this.y < 0 || this.y > canvas.height ? -this.vy : this.vy;
			this.vx = this.x < 0 || this.x > canvas.width ? -this.vx : this.vx;
		};

    let _continueMoving = function() {
			this.x += this.vx;
			this.y += this.vy;
    }

		let _update = function() {
			this.checkCollision();
      if(!paused) this.continueMoving();
			if (thresholdsVisible) this.drawCircle();
			this.drawSelf();
		};

		return {
			update: _update,
			checkCollision: _checkCollision,
      continueMoving: _continueMoving,
			drawSelf: _drawSelf,
			drawCircle: _drawCircle,
			connectTo: _connectTo,
			disconnectFrom: _disconnectFrom,
			isConnectedTo: _isConnectedTo,
			getNeighbors: _getNeighbors
		};

	}();

	let _loop = function(callback) {
		callback();

		window.requestAnimationFrame(
			function() {
				config.statDisplay.begin();
				Constellation.loop(callback);
				config.statDisplay.end();
			}
		);
	};

	let _updateStars = function() {

		context.clearRect(0, 0, canvas.width, canvas.height);

		config.stars.map(s => s.update());

// 		if (t % 30 === 0) {

// 			A3 = math.multiply(
// 				math.multiply(adjacencyMatrix, adjacencyMatrix),
// 				adjacencyMatrix
// 			);

// 			xi = zeroSimplexes - oneSimplexes + twoSimplexes;

// 			numComponents = jsnum.asNDArray(laplacian.toJSON().data).nullity();

// 			twoSimplexes = math.trace(A3) / 6;

// 			$0Simplexes.html(`${zeroSimplexes}`);
// 			$1Simplexes.html(`${oneSimplexes}`);
// 			$2Simplexes.html(`${twoSimplexes}`);
// 			$3Simplexes.html(`${threeSimplexes}`);

// 			xi = zeroSimplexes - oneSimplexes + twoSimplexes;
// 			$eulerCharacteristic.html(`${xi}`);
// 			$numComponents.html(numComponents);

// 			$('#adjacencyMatrix').html(
// 				`<h7> Adjacency Matrix </h7><br> ${matrixPrint(adjacencyMatrix.toJSON().data)}`
// 			);

// 			$('#degreeMatrix').html(
// 				`<h7> Degree Matrix </h7><br> ${matrixPrint(degreeMatrix.toJSON().data)}`
// 			);

// 			$('#laplacianMatrix').html(
// 				`<h7> Laplacian </h7><br> ${matrixPrint(laplacian.toJSON().data)}`
// 			);
// 		}
// 		t += 1;

		for (var i = 0; i < config.numStars; i++) {
			var iStar = config.stars[i];
			for (var j = i + 1; j < config.numStars; j++) {
				var jStar = config.stars[j];
				if (
					Math.abs(iStar.x - jStar.x) < config.linkThreshold &&
					Math.abs(iStar.y - jStar.y) < config.linkThreshold
				) {
					iStar.connectTo(jStar);
				} else {
					iStar.disconnectFrom(jStar);
				}
			}
		}

	};

	return {
		start: function(options) {
			config = $.extend(true, {}, defaults, options);

			canvas = document.getElementById(config.canvas);
			context = canvas.getContext('2d');

			canvas.width = config.width;
			canvas.height = config.height;
			context.fillStyle = config.star.color;
			context.strokeStyle = config.line.color;
			context.lineWidth = config.line.width;
			context.font = "14px Arial";

			config.position = {
				x: canvas.width * 0.5,
				y: canvas.height * 0.5
			};

			for (i = 0; i < config.numStars; i++) {
				config.stars.push(new Star(i));
			}

			adjacencyMatrix = math.zeros(config.numStars, config.numStars);
			laplacian = math.zeros(config.numStars, config.numStars);
			degreeMatrix = math.zeros(config.numStars, config.numStars);

			zeroSimplexes = config.stars.length;

			$0Simplexes = $("#0Simplexes");
			$1Simplexes = $("#1Simplexes");
			$2Simplexes = $("#2Simplexes");
			$3Simplexes = $("#3Simplexes");

			$eulerCharacteristic = $('#eulerCharacteristic');
			$numComponents = $('#numComponents');

			_loop(_updateStars);
		},

		loop: _loop,

		setLinkTreshold(value) {
			config.linkThreshold = value;
		},

		togglePause() {
			paused = !paused;
		},

		toggleThresholds() {
			thresholdsVisible = !thresholdsVisible;
		},

		resetVertices() {
			config.stars = [];
			for (i = 0; i < config.numStars; i++) {
				config.stars.push(new Star(i));
			}
		}
	};
})();

let nodeRadius = 5,
	initialThreshold = nodeRadius * 30;

var config = {
	canvas: 'canvasContents',
	star: {
		radius: nodeRadius,
		color: "rgba(0,51,128, 0.8)"
	},
	line: {
		width: 0.5 * nodeRadius,
		color: "rgba(46,178,255, 0.3)"
	},
	numStars: 20,
	paused: false,
	linkThreshold: initialThreshold,
	statDisplay: getStats()
};

Constellation.start(config);

$("#toggleThreshold").click(Constellation.toggleThresholds);
$("#getNewVertices").click(Constellation.resetVertices);
$("#togglePause").click(Constellation.togglePause);

$("#thresholdTweak").prop({
	min: nodeRadius,
	max: Math.max(
		$("#canvasContainer").height(),
		$("#canvasContainer").width()
	),
	value: initialThreshold
});

function showVal(newVal) {
	document.getElementById("thresholdOutput").innerHTML = newVal;
	Constellation.setLinkTreshold(newVal);
}
