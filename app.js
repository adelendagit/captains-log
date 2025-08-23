require('dotenv').config();
const express   = require('express');
const helmet    = require('helmet');
const morgan    = require('morgan');
const compression = require('compression');
const path      = require('path');
const session   = require('express-session');
const passport  = require('passport');
const TrelloStrategy = require('passport-trello').Strategy;
const captainsLog = require('./routes/captainsLog');
const auth      = require('./routes/auth');

const app = express();
//app.use(helmet());
const { contentSecurityPolicy: csp } = require('helmet');

app.use(
  helmet({
    contentSecurityPolicy: false,  // disable the default so we can supply our own
  })
);

app.use(
  csp({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://unpkg.com",
        "https://cdn.jsdelivr.net"           
      ],
      styleSrc: [
        "'self'",
        "https://unpkg.com",          // Leaflet CSS
        "'unsafe-inline'"             // for any inline styles injected by Leaflet
      ],
      imgSrc: [
        "'self'",
        "data:",                      // marker icons
        "https://*.tile.openstreetmap.org", // map tiles
        "https://unpkg.com",
        "https://trello-members.s3.amazonaws.com"
      ],
      connectSrc: [
        "'self'",
        "https://api.trello.com"
      ],
      fontSrc: [
        "'self'",
        "https://unpkg.com"
      ]
    }
  })
);


app.use(express.json());
app.use(compression());
app.use(morgan('tiny'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));


app.use(
  session({
    secret: process.env.SESSION_SECRET || 'trellosession',
    resave: false,
    saveUninitialized: false
  })
);
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

if (process.env.TRELLO_OAUTH_KEY && process.env.TRELLO_OAUTH_SECRET) {
  passport.use(
    new TrelloStrategy(
      {
        consumerKey: process.env.TRELLO_OAUTH_KEY,
        consumerSecret: process.env.TRELLO_OAUTH_SECRET,
        trelloParams: { scope: 'read,write', expiration: '1day' }
      },
      (token, tokenSecret, profile, done) => {
        profile.token = token;
        profile.tokenSecret = tokenSecret;
        return done(null, profile);
      }
    )
  );
} else {
  console.warn('Trello OAuth environment variables not set; login will be disabled');
}

app.set('trust proxy', true);
app.use('/auth', auth);
app.use('/', captainsLog);

// **AFTER** the static middleware, **before** your 404 handler
app.get('/', (req, res) => {
  res.redirect('/captains-log');
});


// 404 handler
app.use((req,res) => res.status(404).send('Not found'));

// global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
