const stage = document.getElementById("svs");
ctx = stage.getContext("2d");
let x = 10;
let y = 10;
const wid = 21;
const hei = 21;
const width = stage.width;
const height = stage.height;
const ds = 5;
let pathColor = "#156289";
const path = [];
let trailing = false;
let selectedIdentification = "torus";
const pi = Math.PI;
const cos = Math.cos;
const sin = Math.sin;
const rd = Math.round;

const identificationType = {
  torus: (x, y, keycode) => {
    debugger;
    // aba^{-1}b^{-1}
    switch (keycode) {
      case 84:
        trailing = !trailing;
        path.length = 0;
        break;
      case 39:
        // Right
        x = x + ds < width ? x + ds : 0;
        break;
      case 37:
        // Left
        x = x - ds >= 0 ? x - ds : width - ds;
        break;
      case 38:
        // Up
        y = y - ds >= 0 ? y - ds : height - ds;
        break;
      case 40:
        // Down
        y = y + ds < height ? y + ds : 0;
        break;
    }
    return { x: x, y: y };
  },
  rp2: (x, y, keycode) => {
    // abab
    switch (keycode) {
      case 84:
        trailing = !trailing;
        path.length = 0;
        break;
      case 39:
        // Right
        if (x + ds >= width) {
          x = 0;
          y = height - y;
        } else {
          x = x + ds;
        }
        break;
      case 37:
        // Left
        if (x - ds < 0) {
          x = width - ds;
          y = height - y;
        } else {
          x = x - ds;
        }
        break;
      case 38:
        // Up
        if (y - ds < 0) {
          y = height - ds;
          x = width - x;
        } else {
          y = y - ds;
        }
        break;
      case 40:
        // Down
        if (y + ds >= height) {
          y = 0;
          x = width - x;
        } else {
          y = y + ds;
        }
        break;
    }
    return { x: x, y: y };
  }
};

const drawRect = (x, y, w, h) => {
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(x - 7, y - 7, w, h);
};

const drawNode = (x, y, w, h, color) => {
  ctx.fillStyle = color;
  ctx.fillRect(x - 7 + width / 2, y - 7 + height / 2, w, h);
};

const drawCenter = (x, y) => {
  ctx.fillStyle = pathColor;
  ctx.fillRect(x, y, 5, 5);
};

const redraw = () => {
  redrawRoots(+$("#roots").val());
  drawRect(x, y, wid, hei);
  drawCenter(x, y);
};

window.onkeydown = function(event) {
  path.push({ x: x, y: y });
  // console.log(path.slice(-1)[0])
  const newPosition = identificationType[document.getElementById("Topology").value](x, y, event.keyCode);
  x = newPosition.x;
  y = newPosition.y;
  redraw();
};



const rootsOfUnity = n => {
  const roots = Array(n)
    .fill(0)
    .map((s, i) => i)
    .map(k => ({
      x: rd(70 * cos(2 * k * pi / n)),
      y: rd(70 * sin(2 * k * pi / n))
    }));
  return roots;
};

const redrawRoots = n => {
  ctx.clearRect(0, 0, width, height);
  if (trailing) {
    path.map(o => {
      drawCenter(o.x, o.y, 5, 5);
    });
  }
  drawNode(0, 0, 10, 10, "green");
  rootsOfUnity(n).map(r => {
    drawNode(r.x, r.y, 5, 5, "red");
  });
  drawRect(x, y, wid, hei);
  drawCenter(x, y);
};

$("#roots").bind("keyup mouseup", function() {
  if (+this.value > 0) redrawRoots(+this.value);
});

$("#colors").change(function() {
  pathColor = this.value;
});

const getMousePos = (evt) => {
  var rect = stage.getBoundingClientRect();
  return {
    x: evt.clientX - rect.left,
    y: evt.clientY - rect.top
  };
}

//stage.addEventListener(
  //"click",
  //function(evt) {
    //const pos = getMousePos(evt);
    //x = rd(pos.x);
    //y = rd(pos.y);
    //redraw();
  //},
  //false
//);

//selectedIdentification

drawRect(x, y, wid, hei);
drawCenter(x, y);
redrawRoots(4);
