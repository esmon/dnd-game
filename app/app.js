new Vue({
  el: '#app',
  data: {
    gameState: false,
    monsterAttackCompleted: true,
    monsterDice: '2d8',
    monsterName: '',
    monsterHealth: 100,
    monsterMaxHealth: '',
    playerAvatar: null,
    playerHealth: 100,
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
    fetchPlayerData() {
      const player = 'http://localhost:3001/api/player';

      fetch(player)
      .then(res => res.json())
      .then(data => {
        this.playerAvatar = data.avatarUrl;
        this.playerHealth = 100;
        this.playerMaxHealth = 39;
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
        // this.monsterDice = data.actions;
      })
      .catch(err => { throw err });
    },
    startGame() {
      this.gameState = true;
      this.turns = [];
      this.fetchPlayerData();
      this.fetchMonsterData();
    },
    attack: function() {
      if (this.monsterAttackCompleted) {
        const damage = this.calcDamage(this.playerDice);

        this.monsterHealth -= Math.floor((damage/this.monsterMaxHealth) * 100);
        this.monsterMaxHealth -= damage;
        this.turns.unshift({
          isPlayer: true,
          text: this.playerName + ' attacks ' + this.monsterName + ' with ' + this.playerWeaponName + ' for ' + damage + 'hp'
        });

        if (this.checkWin()) {
          return;
        }

        this.monsterAttack();
      }
    },
    specialAttack: function() {
      if (this.monsterAttackCompleted) {
        const damage = this.calcDamage(this.playerDice);

        this.monsterHealth -= Math.floor((damage/this.monsterMaxHealth) * 100);
        this.monsterMaxHealth -= damage;
        this.turns.unshift({
          isPlayer: true,
          text: 'player special attacks monster for ' + damage + 'hp'
        });

        if (this.checkWin()) {
          return;
        }

        this.monsterAttack();
      }
    },
    heal: function() {
      if (this.monsterAttackCompleted) {
        if(this.playerHealth <= 90){
          this.playerHealth += 10;
        } else {
          this.playerHealth = 100;
        }
        this.turns.unshift({
          isPlayer: true,
          text: 'player heals for 10hp'
        });
        this.monsterAttack();
      }
    },

    monsterAttack: function() {
      const self = this;
      const damage = this.calcDamage(this.monsterDice);

      this.monsterAttackCompleted = false;

      setTimeout(function(){
        self.playerHealth -= Math.floor((damage/self.playerMaxHealth) * 100);
        self.playerMaxHealth -= damage;
        self.checkWin();
        self.turns.unshift({
          isPlayer: false,
          text: self.monsterName + ' attacks ' + self.playerName + ' for ' + damage + 'hp'
        });
        self.monsterAttackCompleted = true;
      }, 1000);
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
          if (confirm('you won! start new game?')){
            self.startGame();
          } else {
            self.gameState = false;
          }
        }, 500);

        return true;
      } else if (this.playerMaxHealth && this.playerHealth <=0) {
        this.playerMaxHealth = 0;
        this.playerHealth = 0;

        setTimeout(function(){
          if (confirm('you lost! start new game?')){
            self.startGame();
          } else {
            self.gameState = false;
          }
        }, 500);

        return true;
      }
      return false;
    }
  }
});
