import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import crewRouter from "./crew";
import eventsRouter from "./events";
import shiftsRouter from "./shifts";
import paymentsRouter from "./payments";
import adminRouter from "./admin";
import referralsRouter from "./referrals";
import storageRouter from "./storage";
import placesRouter from "./places";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(placesRouter);
router.use(authRouter);
router.use(crewRouter);
router.use(eventsRouter);
router.use(shiftsRouter);
router.use(paymentsRouter);
router.use(adminRouter);
router.use(referralsRouter);

export default router;
