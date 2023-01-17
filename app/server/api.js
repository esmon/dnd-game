const express = require('express');
const superagent = require('superagent');
var api = express.Router();

// middleware that is specific to this router
api.use(function timeLog (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next()
});

// player data
api.get('/player', function (req, res) {
  const playerData = require('./json/player');

  res.json(playerData.character);
});

// monster data
api.get('/monster/:monster?', function (req, res) {
  superagent
    .get(`https://www.dnd5eapi.co/api/monsters/${req.query.monster}`)
    .then(response => {
      res.json(response.body);
    })
    .catch(console.error);
});

module.exports = api
