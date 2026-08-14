const MOORING_COLOR = "#ff9f1a";

function mooringLabelsForPlace(place) {
  return (place?.labels || []).filter(
    (label) =>
      String(label?.trelloColor || "").toLowerCase() === "orange" ||
      String(label?.color || "").toLowerCase() === MOORING_COLOR,
  );
}

function placeIconKind(place) {
  const text = mooringLabelsForPlace(place)
    .map((label) => label.name)
    .join(" ")
    .toLowerCase();

  if (/buoy|mooring/.test(text)) return "mooring";
  if (/marina|berth|pontoon|quay|dock|harbou?r|port/.test(text)) {
    return "marina";
  }
  if (/anchor|anchorage/.test(text)) return "anchor";
  return "place";
}

const PLACE_ICONS = Object.freeze({
  mooring: Object.freeze({
    iosSystemImage: "lifepreserver.fill",
    webIconClass: "fa-life-ring",
  }),
  marina: Object.freeze({
    iosSystemImage: "building.2.fill",
    webIconClass: "fa-warehouse",
  }),
  anchor: Object.freeze({
    iosSystemImage: "anchor",
    webIconClass: "fa-anchor",
  }),
  place: Object.freeze({
    iosSystemImage: "mappin",
    webIconClass: "fa-location-dot",
  }),
});

function buildPlacePresentation(place) {
  const mooringLabels = mooringLabelsForPlace(place);
  const icon = placeIconKind(place);
  return {
    icon,
    ...PLACE_ICONS[icon],
    mooringSummary:
      mooringLabels.length > 0
        ? mooringLabels.map((label) => label.name).join(", ")
        : null,
  };
}

function withPlacePresentation(place) {
  return { ...place, presentation: buildPlacePresentation(place) };
}

module.exports = {
  buildPlacePresentation,
  mooringLabelsForPlace,
  placeIconKind,
  withPlacePresentation,
};
