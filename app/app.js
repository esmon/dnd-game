new Vue({
  el: '#app',
  data: {
    gameState: false,
    gameStats: {
      loses: 0,
      runAways: 0,
      wins: 0
    },
    monsterAttackCompleted: true,
    monsterAvatar: null,
    monsterDice: '2d8',
    monsterName: '',
    monsterHealth: 100,
    monsterMaxHealth: '',
    playerAvatar: null,
    playerHealthBar: 100,
    playerHealthCount: '',
    playerMaxHealth: '',
    playerName: '',
    playerDice: '',
    playerWeaponName: '',
    turns: []
  },
  beforeMount () {
    this.startGame();
  },
  methods: {
    attack: function() {
      if (this.monsterAttackCompleted) {
        const damage = this.calcDamage(this.playerDice);

        this.monsterHealth -= Math.floor((damage/this.monsterMaxHealth) * 100);
        this.monsterMaxHealth -= damage;
        this.logEvent(true, this.playerName, this.monsterName, damage);

        if (this.checkWin()) return;

        this.monsterAttack();
      }
    },

    calcDamage: function(die) {
      const dieArr = die.split('d');
      const numberOfDice = dieArr[0];
      const maxDamage = dieArr[1];
      const randomDmgCalc = Math.max(Math.floor(Math.random() * maxDamage) + 1, 1);

      if (numberOfDice > 1) {
        const die1 = randomDmgCalc;
        const die2 = randomDmgCalc;
        return die1 + die2;
      }

      return randomDmgCalc;
    },

    checkWin: function() {
      const self = this;

      if (this.monsterMaxHealth && this.monsterHealth <= 0) {
        this.monsterMaxHealth = 0;
        this.monsterHealth = 0;

        setTimeout(function(){
          if (confirm('you won! start new game?')) {
            self.gameStats.wins++;
            if (self.gameStats.wins > 2) self.playerHealthCount = self.playerMaxHealth;
            self.fetchMonsterData();
          } else {
            self.gameState = false;
          }
        }, 500);

        return true;
      } else if (this.playerHealthCount && this.playerHealthBar <= 0) {
        this.playerHealthCount = 0;
        this.playerHealthBar = 0;

        setTimeout(function(){
          if (confirm('you lost! start new game?')) {
            self.gameStats.loses++;
            self.gameStats.wins = 0;
            self.startGame();
          } else {
            self.gameState = false;
          }
        }, 500);

        return true;
      }
      return false;
    },

    fetchPlayerData() {
      const player = 'http://localhost:3001/api/player';

      fetch(player)
      .then(res => res.json())
      .then(data => {
        this.playerAvatar = data.avatarUrl;
        this.playerHealthBar = 100;
        this.playerMaxHealth = data.hitPoints.max;
        this.playerHealthCount = this.playerMaxHealth;
        this.playerName = data.name;
        this.playerDice = data.inventory.weapons[1].definition.damage.diceString;
        this.playerWeaponName = data.inventory.weapons[1].definition.name;
      })
      .catch(err => { throw err });
    },

    fetchMonsterData() {
      const monster = 'http://localhost:3001/api/monster';

      fetch(monster)
      .then(res => res.json())
      .then(data => {
        this.monsterName = data.name;
        this.monsterHealth = 100;
        this.monsterMaxHealth = data.hit_points;
        this.monsterDice = data.hit_dice;

        if (data.image) this.monsterAvatar = `https://www.dnd5eapi.co${data.image}`;
      })
      .catch(err => { throw err });
    },

    logEvent: function(isPlayer, character, monster, damage) {
      let text;

      if (isPlayer) {
        text = character + ' attacks ' + monster + ' with ' + this.playerWeaponName + ' for ' + damage + 'hp';
      } else {
        text = monster + ' attacks ' + character + ' for ' + damage + 'hp'
      }

      this.turns.unshift({
        isPlayer,
        text
      });
    },

    heal: function(runningAway) {
      if (runningAway) return;

      if (this.monsterAttackCompleted) {
        var randomHealthCalc = Math.max(Math.floor(Math.random() * 10) + 1, 1)

        if(this.playerHealthCount <= (this.playerMaxHealth - 10)){
          this.playerHealthBar += randomHealthCalc;
          this.playerHealthCount += randomHealthCalc;
        } else {
          this.playerHealthBar = 100;
          this.playerHealthCount = this.playerMaxHealth;
        }
        
        this.turns.unshift({
          isPlayer: true,
          text: 'player heals for ' + randomHealthCalc
        });

        if (this.checkWin()) return;

        this.monsterAttack();
      }
    },

    monsterAttack: function() {
      const self = this;
      const damage = this.calcDamage(this.monsterDice);

      this.monsterAttackCompleted = false;

      setTimeout(function(){
        self.playerHealthBar -= Math.floor((damage/self.playerHealthCount) * 100);
        self.playerHealthCount -= damage;
        self.checkWin();
        self.logEvent(false, self.playerName, self.monsterName, damage);

        self.monsterAttackCompleted = true;
      }, 1000);
    },

    runAway: function() {
      var chanceToRunaway = Math.random() < 0.4;

      if (chanceToRunaway) {
        this.fetchMonsterData();
        this.heal(true);
        this.gameStats.runAways++;

        this.turns.unshift({
          isPlayer: true,
          text: this.playerName + ' succesfully runs away!'
        });
      } else {
        this.monsterAttack();
      }
    },

    specialAttack: function() {
      if (this.monsterAttackCompleted) {
        const damage = this.calcDamage(this.playerDice);

        this.monsterHealth -= Math.floor((damage/this.monsterMaxHealth) * 100);
        this.monsterMaxHealth -= damage;
        this.logEvent(true, this.playerName, damage);

        if (this.checkWin()) {
          return;
        }

        this.monsterAttack();
      }
    },

    startGame() {
      this.gameState = true;
      this.turns = [];
      this.fetchPlayerData();
      this.fetchMonsterData();
    }
  }
});
