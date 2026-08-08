# Regional coastline data

`greece-land-250m.geo.json` contains only the Greece feature extracted from
`@geo-maps/countries-land-250m` version 0.6.0. Keeping the regional feature
avoids loading the roughly 87 MB global 250 m dataset at runtime.

The upstream GeoJSON is generated from OpenStreetMap data by
[simonepri/geo-maps](https://github.com/simonepri/geo-maps). Upstream data is
licensed under the Open Data Commons Public Domain Dedication and License;
the generator source is MIT licensed.
