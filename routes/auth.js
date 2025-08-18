const express = require('express');
const passport = require('passport');

const router = express.Router();

// Initiates Trello authentication
router.get('/trello', passport.authenticate('trello'));

// Callback URL Trello will redirect to after authorization
router.get('/trello/callback',
  passport.authenticate('trello', { failureRedirect: '/login?error=trello' }),
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
