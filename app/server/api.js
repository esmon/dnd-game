var express = require('express');
var api = express.Router();
var request = require('request');

// middleware that is specific to this router
api.use(function timeLog (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next()
})

// player data
api.get('/player', function (req, res) {
  const playerData = require('./json/player');

  res.json(playerData.character)
})

// monster data
api.get('/monster', function (req, res) {
  const monsterData = require('./json/monster-list');

  const monster = monsterData.results[Math.floor(Math.random() * monsterData.results.length - 1)];

  request(monster.url).pipe(res);
})


module.exports = api
