const path = require('path');

function add(a, b) {
  return a + b;
}

function multiply(a, b) {
  return add(a, b) * 2;
}

class Calculator {
  constructor() {
    this.history = [];
  }

  compute(a, b) {
    return add(a, b);
  }
}

module.exports = { add, multiply, Calculator };
