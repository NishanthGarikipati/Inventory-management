import { Router } from 'express';
import { authRouter } from './auth.routes.js';
import { businessRouter } from './business.routes.js';
import { productRouter } from './product.routes.js';
import { inventoryRouter } from './inventory.routes.js';
import { saleRouter } from './sale.routes.js';
import { purchaseRouter } from './purchase.routes.js';
import { customerRouter, paymentRouter, supplierRouter } from './party.routes.js';
import { returnsRouter } from './returns.routes.js';
import { scannerRouter } from './scanner.routes.js';
import { dashboardRouter, reportRouter } from './report.routes.js';
import {
  auditRouter,
  closingRouter,
  expenseRouter,
  notificationRouter,
  productionRouter,
} from './operations.routes.js';
import { syncRouter } from './sync.routes.js';
import { searchRouter } from './search.routes.js';

export const apiRouter: Router = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/business', businessRouter);
apiRouter.use('/products', productRouter);
apiRouter.use('/inventory', inventoryRouter);
apiRouter.use('/sales', saleRouter);
apiRouter.use('/purchases', purchaseRouter);
apiRouter.use('/customers', customerRouter);
apiRouter.use('/suppliers', supplierRouter);
apiRouter.use('/payments', paymentRouter);
apiRouter.use('/returns', returnsRouter);
apiRouter.use('/scanner', scannerRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/reports', reportRouter);
apiRouter.use('/expenses', expenseRouter);
apiRouter.use('/closing', closingRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/production', productionRouter);
apiRouter.use('/audit', auditRouter);
apiRouter.use('/sync', syncRouter);
apiRouter.use('/search', searchRouter);
