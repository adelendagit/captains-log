const express = require('express');
const passport = require('passport');
const {
  createPairingCode,
  exchangePairingCode,
} = require('../services/mobileAuth');

const router = express.Router();

// Initiates Trello authentication (only if strategy is configured)
router.get('/trello', (req, res, next) => {
  const strat = passport._strategy('trello');
  if (!strat) return res.status(503).send('Trello login not configured');
  req.session.loginClient = req.query.client === 'ios' ? 'ios' : 'web';
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  passport.authenticate('trello', {
    callbackURL: `${baseUrl}/auth/trello/callback`
  })(req, res, next);
});

// Callback URL Trello will redirect to after authorization
router.get('/trello/callback', (req, res, next) => {
  const strat = passport._strategy('trello');
  if (!strat) return res.status(503).send('Trello login not configured');
  passport.authenticate('trello', { failureRedirect: '/login?error=trello' })(req, res, next);
},
  (req, res) => {
    if (req.session.loginClient === 'ios') {
      req.session.loginClient = null;
      return res.redirect('/auth/ios/complete');
    }
    res.redirect('/');
  }
);

router.get('/ios/complete', (req, res) => {
  if (!req.user) return res.status(401).send('Trello authentication required');
  const code = createPairingCode(req.user);
  res.redirect(`captainslog://auth?code=${encodeURIComponent(code)}`);
});

router.post('/ios/exchange', (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  const token = exchangePairingCode(code);
  if (!token) return res.status(400).json({ error: 'Invalid or expired login code' });
  res.json({ token, expiresIn: 30 * 24 * 60 * 60 });
});

// Logs the user out and clears their session
router.get('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) { return next(err); }
    res.redirect('/');
  });
});

module.exports = router;
