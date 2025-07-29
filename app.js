require('dotenv').config();
const express   = require('express');
const helmet    = require('helmet');
const morgan    = require('morgan');
const compression = require('compression');
const path      = require('path');
const captainsLog = require('./routes/captainsLog');

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
        "https://unpkg.com"           // Leaflet JS
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
        "https://unpkg.com"               // ← add this line
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


app.use(compression());
app.use(morgan('tiny'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));


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
