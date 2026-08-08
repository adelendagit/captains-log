const { Resend } = require("resend");
const fs = require("fs");
const path = require("path");

const BRAND_NAME = "Skibidi";
const LOGO_CONTENT_ID = "skibidi-logo";
const LOGO_CONTENT = fs
  .readFileSync(path.join(__dirname, "../public/icons/icon-192.png"))
  .toString("base64");

const ACTION_LABELS = {
  arrived: "Arrived",
  departed: "Departed",
  visited: "Visited",
  water: "Water",
  diesel: "Diesel",
  temperature: "Temperature",
  bins: "Bins",
  "bbq-gas-change": "BBQ Gas Change",
  "gas-tank-change": "Gas Tank Change",
  "water-tank-change": "Water Tank Change",
  power: "Power",
  boom: "Boom",
  other: "Other",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseRecipients(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) =>
          typeof entry === "string" ? entry : entry && entry.email,
        )
        .filter(Boolean);
    }
    if (parsed && typeof parsed === "object") {
      return Object.values(parsed)
        .map((entry) =>
          typeof entry === "string" ? entry : entry && entry.email,
        )
        .filter(Boolean);
    }
  } catch (_error) {
    // A comma-separated list is also accepted for simpler deployments.
  }

  return value
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
}

function getNotificationRecipients(mode) {
  if (mode === "test") {
    return process.env.EMAIL_REPLY_TO ? [process.env.EMAIL_REPLY_TO] : [];
  }

  if (mode === "people") {
    return parseRecipients(
      process.env.EMAIL_RECIPIENTS_JSON || process.env.EMAIL_RECIPIENTS,
    );
  }

  return [];
}

function brandedFromAddress(value) {
  const match = String(value || "").match(/<([^>]+)>/);
  const address = (match ? match[1] : value || "").trim();
  return `${BRAND_NAME} <${address}>`;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: process.env.EMAIL_TIME_ZONE || "Europe/Athens",
  }).format(new Date(timestamp));
}

function buildNotification({
  action,
  location,
  lat,
  lng,
  timestamp,
  litres,
  temperature,
  customText,
}) {
  const actionLabel =
    action === "other" && customText ? customText : ACTION_LABELS[action];
  const safeAction = escapeHtml(actionLabel);
  const safeLocation = escapeHtml(location);
  const siteUrl = (
    process.env.PUBLIC_SITE_URL || "https://where.is.achilleas.co.uk"
  ).replace(/\/$/, "");
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
  const hasLitres = Number.isFinite(litres);
  const hasTemperature = Number.isFinite(temperature);
  const headline = `${actionLabel}${action === "arrived" || action === "visited" ? " at" : action === "departed" ? " from" : " at"} ${location}`;
  const details = hasTemperature
    ? `${temperature} °C`
    : hasLitres
      ? `${litres} litres`
      : null;
  const when = formatDate(timestamp);

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f5f7;color:#0a2540;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(headline)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:28px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(10,37,64,.10);">
          <tr>
            <td style="background:#0a2540;padding:24px 30px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="54"><img src="cid:${LOGO_CONTENT_ID}" width="44" height="44" alt="Skibidi" style="display:block;border-radius:12px;background:#ffffff;"></td>
                  <td style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:.02em;">Skibidi</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:34px 30px 12px;">
              <div style="color:#0077cc;font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Skibidi</div>
              <h1 style="margin:10px 0 14px;color:#0a2540;font-size:30px;line-height:1.2;">${safeAction} ${action === "departed" ? "from" : "at"} “${safeLocation}”</h1>
              <p style="margin:0;color:#526577;font-size:16px;line-height:1.6;">${escapeHtml(when)}</p>
              ${details ? `<p style="margin:8px 0 0;color:#526577;font-size:16px;line-height:1.6;">${escapeHtml(details)}</p>` : ""}
            </td>
          </tr>
          <tr>
            <td style="padding:22px 30px 10px;">
              <div style="border:1px solid #dce8f0;border-radius:14px;background:#f6fbfe;padding:22px;">
                <div style="font-size:13px;color:#64748b;margin-bottom:8px;">Position</div>
                <div style="font-size:17px;font-weight:650;color:#0a2540;margin-bottom:18px;">${escapeHtml(lat)}, ${escapeHtml(lng)}</div>
                <a href="${escapeHtml(mapUrl)}" style="display:inline-block;background:#0077cc;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:999px;">Open in Google Maps</a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 30px 36px;">
              <a href="${escapeHtml(siteUrl)}" style="display:inline-block;color:#0077cc;font-weight:700;text-decoration:none;">See the latest voyage plan →</a>
            </td>
          </tr>
          <tr>
            <td style="background:#eef6fa;padding:18px 30px;color:#64748b;font-size:12px;line-height:1.5;">Sent automatically from Skibidi.</td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = [
    headline,
    when,
    details,
    `Position: ${lat}, ${lng}`,
    `Google Maps: ${mapUrl}`,
    `Latest voyage plan: ${siteUrl}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    subject: `Skibidi — ${headline}`,
    html,
    text,
    attachments: [
      {
        content: LOGO_CONTENT,
        contentType: "image/png",
        filename: "skibidi.png",
        contentId: LOGO_CONTENT_ID,
      },
    ],
  };
}

async function sendLogNotification({ mode, idempotencyKey, ...details }) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    const error = new Error("Email notifications are not configured");
    error.status = 503;
    throw error;
  }

  const to = getNotificationRecipients(mode);
  if (!to.length) {
    const error = new Error(
      mode === "test"
        ? "EMAIL_REPLY_TO is not configured"
        : "No notification recipients are configured",
    );
    error.status = 503;
    throw error;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const email = buildNotification(details);
  const { data, error } = await resend.emails.send(
    {
      from: brandedFromAddress(process.env.EMAIL_FROM),
      to,
      replyTo: process.env.EMAIL_REPLY_TO || undefined,
      ...email,
    },
    { idempotencyKey },
  );

  if (error) {
    const sendError = new Error(error.message || "Resend rejected the email");
    sendError.status = 502;
    throw sendError;
  }

  return { id: data && data.id, recipientCount: to.length };
}

module.exports = {
  ACTION_LABELS,
  BRAND_NAME,
  brandedFromAddress,
  buildNotification,
  getNotificationRecipients,
  sendLogNotification,
};
