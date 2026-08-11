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
    const changes = [];
    if (data.linked) {
      changes.push(
        `${data.linked} Plan card${data.linked === 1 ? "" : "s"} linked by attachment`,
      );
    }
    if (data.migrated) {
      changes.push(
        `${data.migrated} place due date${data.migrated === 1 ? "" : "s"} converted`,
      );
    }
    result.textContent = changes.length
      ? `Migration complete: ${changes.join("; ")}.`
      : "Migration complete. Nothing remains to convert.";
    button.textContent = "Migration complete";
  } catch (error) {
    result.className = "error";
    result.textContent = error.message;
    button.disabled = false;
    button.textContent = "Try migration again";
  }
});
