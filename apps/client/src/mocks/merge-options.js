const realMerge = require("../../../../node_modules/merge-options/index.js");

// Create a wrapper that is a function AND has .default
const wrapper = function (...args) {
  return realMerge(...args);
};

Object.assign(wrapper, realMerge);
wrapper.default = wrapper;

module.exports = wrapper;
