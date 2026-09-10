"use strict";
const { Resvg } = require("@resvg/resvg-js");
const path = require("node:path");
function renderSvg(svg) {
  return new Resvg(svg, {
    font: {
      fontFiles: [400, 600].map((w) =>
        path.join(__dirname, `fonts/NotoSansSC-${w}.ttf`),
      ),
      loadSystemFonts: false,
      defaultFontFamily: "Noto Sans SC",
    },
  })
    .render()
    .asPng();
}
module.exports = { renderSvg };
