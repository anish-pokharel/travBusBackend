const { Router } = require("express");
const { body } = require("express-validator");
const c = require("../controllers/tripController");
const { validate } = require("../middleware/validate");
const { authenticate, authorize } = require("../middleware/auth");

const r = Router();
r.get("/search", c.search); // public

const admin = [authenticate, authorize("admin")];
r.get("/upcoming", authenticate, authorize("admin", "counter"), c.upcoming);
r.get("/", ...admin, c.list);
r.get("/:id", c.get); // public trip summary (needed by the booking page)
r.post(
  "/",
  ...admin,
//   validate([
//     body("vehicleId").isMongoId(),
//     body("routeId").isMongoId(),
//     body("departureAt").isISO8601(),
//     // body("arrivalAt").optional().isISO8601(),
//     // Change this line in backend/src/routes/tripRoutes.js:
// // body('arrivalAt').optional({ values: 'falsy' }).isISO8601(),
// body('arrivalAt').optional().isISO8601(),
//     body("fare.base").isFloat({ min: 0, max: 1000000 }),
//     body("fare.categoryPrices").optional().isObject(),
//   ]),
validate([
  body('vehicleId').isMongoId(),
  body('routeId').isMongoId(),
  body('departureAt').isISO8601(),
  body('arrivalAt').optional().isISO8601(),
  body('fare.base').isFloat({ min: 0, max: 1000000 }),
  body('fare.categoryPrices').optional().isObject(),
]),
  c.create,
);
r.patch(
  "/:id",
  ...admin,
  validate([
    body("bookingOpen").optional().isBoolean(),
    body("status").optional().isIn(["boarding", "departed", "completed"]),
    body("fare.base").optional().isFloat({ min: 0, max: 1000000 }),
  ]),
  c.update,
);
r.post("/:id/cancel", ...admin, c.cancel);
r.post(
  "/:id/block-seats",
  ...admin,
  validate([
    body("seatIds").isArray({ min: 1, max: 60 }),
    body("blocked").isBoolean(),
  ]),
  c.setSeatBlock,
);

module.exports = r;





