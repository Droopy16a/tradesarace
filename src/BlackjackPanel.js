import React, { useMemo, useState } from 'react';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['S', 'H', 'D', 'C'];

function createDeck() {
  const deck = [];
  RANKS.forEach((rank) => {
    SUITS.forEach((suit) => {
      deck.push({ rank, suit });
    });
  });
  return deck;
}

function shuffleDeck(sourceDeck) {
  const deck = [...sourceDeck];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(rank) {
  if (rank === 'A') return 11;
  if (rank === 'K' || rank === 'Q' || rank === 'J') return 10;
  return Number(rank);
}

function handValue(cards) {
  let total = cards.reduce((sum, card) => sum + cardValue(card.rank), 0);
  let aces = cards.filter((card) => card.rank === 'A').length;

  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }

  return total;
}

function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards) === 21;
}

function getSuitMeta(suit) {
  if (suit === 'H') return { symbol: '\u2665', colorClass: 'red' };
  if (suit === 'D') return { symbol: '\u2666', colorClass: 'red' };
  if (suit === 'S') return { symbol: '\u2660', colorClass: 'dark' };
  return { symbol: '\u2663', colorClass: 'dark' };
}

export default function BlackjackPanel({ availableBalance, onSettle }) {
  const [bet, setBet] = useState('100');
  const [deck, setDeck] = useState([]);
  const [playerCards, setPlayerCards] = useState([]);
  const [dealerCards, setDealerCards] = useState([]);
  const [roundActive, setRoundActive] = useState(false);
  const [roundMessage, setRoundMessage] = useState('');
  const [isSettling, setIsSettling] = useState(false);
  const [roundKey, setRoundKey] = useState(0);

  const playerTotal = useMemo(() => handValue(playerCards), [playerCards]);
  const dealerTotal = useMemo(() => handValue(dealerCards), [dealerCards]);

  async function settleRound(delta, message) {
    setIsSettling(true);
    const ok = await onSettle(delta, message);
    setIsSettling(false);
    if (!ok) {
      setRoundMessage('Unable to settle this round.');
      return false;
    }
    setRoundMessage(message);
    return true;
  }

  async function startRound() {
    if (roundActive || isSettling) return;

    const wager = Number(bet);
    if (!Number.isFinite(wager) || wager <= 0) {
      setRoundMessage('Enter a valid bet amount.');
      return;
    }
    if (wager > availableBalance) {
      setRoundMessage('Bet exceeds available balance.');
      return;
    }

    const nextDeck = shuffleDeck(createDeck());
    const nextPlayerCards = [nextDeck[0], nextDeck[2]];
    const nextDealerCards = [nextDeck[1], nextDeck[3]];
    const remainingDeck = nextDeck.slice(4);

    setPlayerCards(nextPlayerCards);
    setDealerCards(nextDealerCards);
    setDeck(remainingDeck);
    setRoundActive(true);
    setRoundKey((value) => value + 1);
    setRoundMessage('Round started. Hit or stand.');

    const playerBj = isBlackjack(nextPlayerCards);
    const dealerBj = isBlackjack(nextDealerCards);

    if (!playerBj && !dealerBj) return;

    let delta = 0;
    let message = 'Push. Both hit blackjack.';
    if (playerBj && !dealerBj) {
      delta = wager * 1.5;
      message = `Blackjack! You win ${delta.toFixed(2)} USD.`;
    } else if (!playerBj && dealerBj) {
      delta = -wager;
      message = `Dealer blackjack. You lose ${Math.abs(delta).toFixed(2)} USD.`;
    }

    const settled = await settleRound(delta, message);
    if (settled) setRoundActive(false);
  }

  async function hit() {
    if (!roundActive || isSettling || deck.length === 0) return;

    const drawnCard = deck[0];
    const nextDeck = deck.slice(1);
    const nextPlayerCards = [...playerCards, drawnCard];
    const nextTotal = handValue(nextPlayerCards);

    setDeck(nextDeck);
    setPlayerCards(nextPlayerCards);

    if (nextTotal <= 21) return;

    const wager = Number(bet);
    const delta = -wager;
    const settled = await settleRound(delta, `Bust. You lose ${Math.abs(delta).toFixed(2)} USD.`);
    if (settled) setRoundActive(false);
  }

  async function stand() {
    if (!roundActive || isSettling) return;

    const wager = Number(bet);
    const dealerHand = [...dealerCards];
    const nextDeck = [...deck];

    while (handValue(dealerHand) < 17 && nextDeck.length > 0) {
      dealerHand.push(nextDeck.shift());
    }

    const playerScore = handValue(playerCards);
    const dealerScore = handValue(dealerHand);
    let delta = 0;
    let message = 'Push. Bet returned.';

    if (dealerScore > 21 || playerScore > dealerScore) {
      delta = wager;
      message = `You win ${delta.toFixed(2)} USD.`;
    } else if (playerScore < dealerScore) {
      delta = -wager;
      message = `Dealer wins. You lose ${Math.abs(delta).toFixed(2)} USD.`;
    }

    setDealerCards(dealerHand);
    setDeck(nextDeck);
    const settled = await settleRound(delta, message);
    if (settled) setRoundActive(false);
  }

  function renderCard(card, index, hidden = false) {
    if (hidden) {
      return (
        <div
          key={`hidden-${roundKey}-${index}`}
          className="bj-card hidden"
          style={{ animationDelay: `${index * 70}ms` }}
        >
          <div className="bj-card-pattern" />
        </div>
      );
    }

    const { symbol, colorClass } = getSuitMeta(card.suit);
    return (
      <div
        key={`${card.rank}${card.suit}-${roundKey}-${index}`}
        className={`bj-card ${colorClass}`}
        style={{ animationDelay: `${index * 70}ms` }}
      >
        <span className="bj-card-corner top">{card.rank}{symbol}</span>
        <span className="bj-card-center">{symbol}</span>
        <span className="bj-card-corner bottom">{card.rank}{symbol}</span>
      </div>
    );
  }

  return (
    <section className="blackjack-panel">
      <div className="blackjack-head">
        <h2>Blackjack vs Bot</h2>
        <span>Win cash for your wallet</span>
      </div>

      <div className="blackjack-bet-row">
        <label htmlFor="blackjackBet">Bet (USD)</label>
        <div className="blackjack-chip-row">
          {[25, 100, 250].map((chip) => (
            <button
              key={chip}
              type="button"
              className="blackjack-chip"
              disabled={roundActive || isSettling}
              onClick={() => setBet(String(chip))}
            >
              ${chip}
            </button>
          ))}
        </div>
      </div>

      <input
        id="blackjackBet"
        type="number"
        min="1"
        step="1"
        value={bet}
        onChange={(event) => setBet(event.target.value)}
        disabled={roundActive || isSettling}
      />

      <div className="blackjack-table">
        <div className="blackjack-felt">
          <div className="blackjack-betting-ring" />
          <div className="blackjack-deck-stack" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <article className="blackjack-seat dealer">
            <strong>Dealer ({roundActive ? '?' : dealerTotal})</strong>
            <div className="bj-cards-row dealer-row">
              {dealerCards.length
                ? dealerCards.map((card, index) => renderCard(card, index, roundActive && index === 1))
                : <p className="blackjack-empty">No cards</p>}
            </div>
          </article>
          <article className="blackjack-seat player">
            <strong>You ({playerTotal || 0})</strong>
            <div className="bj-cards-row player-row">
              {playerCards.length
                ? playerCards.map((card, index) => renderCard(card, index))
                : <p className="blackjack-empty">No cards</p>}
            </div>
          </article>
        </div>
      </div>

      <div className="blackjack-actions">
        <button type="button" onClick={startRound} disabled={roundActive || isSettling}>
          Deal
        </button>
        <button type="button" onClick={hit} disabled={!roundActive || isSettling}>
          Hit
        </button>
        <button type="button" onClick={stand} disabled={!roundActive || isSettling}>
          Stand
        </button>
      </div>

      {roundMessage && <p className="blackjack-message">{roundMessage}</p>}
    </section>
  );
}
