const express = require('express');
const passport = require('passport');

const router = express.Router();

// Initiates Trello authentication (only if strategy is configured)
router.get('/trello', (req, res, next) => {
  const strat = passport._strategy('trello');
  if (!strat) return res.status(503).send('Trello login not configured');
  passport.authenticate('trello')(req, res, next);
});

// Callback URL Trello will redirect to after authorization
router.get('/trello/callback', (req, res, next) => {
  const strat = passport._strategy('trello');
  if (!strat) return res.status(503).send('Trello login not configured');
  passport.authenticate('trello', { failureRedirect: '/login?error=trello' })(req, res, next);
},
  (req, res) => {
    // Successful authentication, redirect home or desired page
    res.redirect('/');
  }
);

// Logs the user out and clears their session
router.get('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) { return next(err); }
    res.redirect('/');
  });
});

module.exports = router;
