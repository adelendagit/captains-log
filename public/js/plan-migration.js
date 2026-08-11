const button = document.getElementById("migrate");
const result = document.getElementById("result");

button.addEventListener("click", async () => {
  button.disabled = true;
  button.textContent = "Migrating…";
  result.className = "";
  result.textContent = "Creating linked Plan cards…";

  try {
    const response = await fetch("/api/plan/migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Migration failed");

    result.className = "success";
    result.textContent =
      data.migrated === 0
        ? "Migration complete. No legacy due dates remain."
        : `Migration complete. ${data.migrated} planned visit${data.migrated === 1 ? "" : "s"} converted.`;
    button.textContent = "Migration complete";
  } catch (error) {
    result.className = "error";
    result.textContent = error.message;
    button.disabled = false;
    button.textContent = "Try migration again";
  }
});
