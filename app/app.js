new Vue({
  el: '#app',
  data: {
    challenge_rating: 'challenge_rating=0&challenge_rating=0.125&challenge_rating=0.25',
    gameState: false,
    gameStats: {
      loses: 0,
      runAways: 0,
      wins: 0
    },
    monster: {},
    player: {},
    turns: []
  },
  beforeMount () {
    this.startGame();
  },
  methods: {
    attack: function(dice, weaponName) {
      if (this.monster.isAlive && this.monster.attackCompleted) {
        const damage = this.calcDamage(dice);

        this.monster.healthBar -= Math.floor((damage/this.monster.health) * 100);
        this.monster.health -= damage;
        this.monster.attackCompleted = false;

        if (this.monster.health <= 0) this.monster.isAlive = false;

        this.logEvent(true, damage, weaponName);
        this.checkWin();
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

      if (this.monster.isAlive && !this.monster.attackCompleted) {
        this.monsterAttack();
      } else if (!this.monster.isAlive) {
        this.gameState = false;
        this.monster.health = 0;
        this.monster.healthBar = 0;
        this.monster.attackCompleted = true;

        if(this.player.xp) {
          this.player.xp = this.player.xp + this.monster.xp;
        } else {
          this.player.xp = this.monster.xp;
        }
        
        this.logEvent(true, null, null, true);

        setTimeout(function(){
          self.gameStats.wins++;

          if (self.gameStats.wins % 3 == 0) {
            self.heal();
          }
        }, 1000);
      } else if (!this.player.isAlive) {
        this.gameState = false;
        this.player.healthCount = 0;
        this.player.healthBar = 0;

        this.logEvent(false, null, null, false);

        setTimeout(function() {
          self.gameStats.loses++;
          self.gameStats.wins = 0;
        }, 1000);
      }
    },

    fetchPlayerData() {
      if (!localStorage.getItem('player')) {
        const playerApi = 'http://localhost:3001/api/player';

        fetch(playerApi)
        .then(res => res.json())
        .then(data => {
          const player = {
            isAlive: true,
            avatar: data.avatarUrl,
            healthBar: 100,
            maxHealth: data.hitPoints.max,
            healthCount: this.player.maxHealth,
            name: data.name,
            weapons: data.inventory.weapons
          };

          this.player = player;

          localStorage.setItem('player', JSON.stringify(player));
        })
        .catch(err => { throw err });
      }
    },

    fetchAllMonsters() {
      const monster = `https://www.dnd5eapi.co/api/monsters/?${this.challenge_rating}`;

      fetch(monster)
      .then(res => res.json())
      .then(data => {
        const monsters = data.results;
        localStorage.setItem('monsters', JSON.stringify(monsters));
      })
      .catch(err => { throw err });
    },

    fightNewMonster: function() {
      this.gameState = true;
      this.monster.attackCompleted = true;
      this.getMonster();
    },

    getMonster() {
      const monsters = JSON.parse(localStorage.getItem('monsters'));
      const monster = monsters[Math.floor(Math.random() * monsters.length - 1)];

      if (typeof monster === 'object') {
        fetch(`http://localhost:3001/api/monster/?monster=${monster.index}`)
        .then(res => res.json())
        .then(data => {
          this.monster = {
            avatar: data.image ? `https://www.dnd5eapi.co${data.image}` : null,
            attackCompleted: true,
            isAlive: true,
            name: data.name,
            healthBar: 100,
            health: data.hit_points,
            dice: data.hit_dice,
            xp: data.xp
          }
        })
        .catch(err => { throw err }); 
      } else {
        this.getMonster();
      }
    },

    getPlayer() {
      if (!localStorage.getItem('player')) {
        this.fetchPlayerData();
      } else {
        const playerData = JSON.parse(localStorage.getItem('player'));

        this.player = {
          isAlive: true,
          avatar: playerData.avatar,
          healthBar: playerData.healthBar,
          healthCount: playerData.maxHealth,
          maxHealth: playerData.maxHealth,
          name: playerData.name,
          weapons: playerData.weapons
        };
      }
    },

    logEvent: function(isPlayer, damage, weaponName, win) {
      let text;

      if (isPlayer && this.player.isAlive && weaponName) {
        text = `${this.player.name} attacks ${this.monster.name} with ${weaponName} for ${damage}hp`;
      } else if (this.player.isAlive) {
        text = `${this.monster.name} attacks ${this.player.name} for ${damage} hp`
      }

      if (isPlayer && this.player.isAlive && win) {
        text = `${this.player.name} wins!`;
      } else if (!isPlayer && !this.player.isAlive && !win)  {
        text = `${this.monster.name} wins!`;
      }

      this.turns.unshift({
        isPlayer,
        text
      });
    },

    heal: function() {
      if (this.monster.attackCompleted && this.player.healthCount !== this.player.maxHealth) {
        let randomHealthCalc = Math.max(Math.floor(Math.random() * 10) + 1, 1);

        if(this.player.healthCount <= (this.player.maxHealth - 10)){
          this.player.healthBar += randomHealthCalc;
          this.player.healthCount += randomHealthCalc;
        } else {
          this.player.healthBar = 100;
          this.player.healthCount = this.player.maxHealth;
        }

        if (this.monster.isAlive && !this.monster.attackCompleted) this.monsterAttack();
        
        this.turns.unshift({
          isPlayer: true,
          text: `${this.player.name} heals for ${randomHealthCalc}`
        });
      }
    },

    monsterAttack: function() {
      const self = this;
      const damage = this.calcDamage(this.monster.dice);

      setTimeout(function() {
        self.player.healthBar -= Math.floor((damage/self.player.healthCount) * 100);
        self.player.healthCount -= damage;
        self.monster.attackCompleted = true;

        self.logEvent(false, damage, null);

        if (self.player.healthCount <= 0) self.player.isAlive = false;

        self.checkWin();
      }, 1000);
    },

    rest: function() {
      this.player.healthBar = 100;
      this.player.healthCount = this.player.maxHealth;
    },

    runAway: function() {
      var chanceToRunaway = Math.random() < 0.4;

      if (chanceToRunaway) {
        this.getMonster();
        this.heal();
        this.gameStats.runAways++;

        this.turns.unshift({
          isPlayer: true,
          text: this.player.name + ' succesfully runs away!'
        });

        return;
      } else {
        this.monsterAttack();

        this.turns.unshift({
          isPlayer: true,
          text: this.player.name + ' failed to run away!'
        });
      }
    },

    startGame() {
      this.gameState = true;
      this.turns = [];
      this.fetchAllMonsters();
      this.getMonster();
      this.getPlayer();
    }
  }
});
