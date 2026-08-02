const express = require("express");
const { fetchOpenTodoCards, markTodoCardDone } = require("../services/todo");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const cards = await fetchOpenTodoCards();
    res.render("todo", { cards });
  } catch (error) {
    next(error);
  }
});

router.post("/:cardId/done", async (req, res, next) => {
  try {
    await markTodoCardDone(req.params.cardId);
    res.json({ success: true });
  } catch (error) {
    if (error.status) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    next(error);
  }
});

module.exports = router;
