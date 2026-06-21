import './app-v4.js';
import { attachEcologyRuntime } from './bootstrap/attachEcologyRuntime.js';
import { attachRoadRuntime } from './bootstrap/attachRoadRuntime.js';
import { attachFarmRuntime } from './bootstrap/attachFarmRuntime.js';
import { attachFoodStorageRuntime } from './bootstrap/attachFoodStorageRuntime.js';

attachEcologyRuntime();
attachRoadRuntime();
attachFarmRuntime();
attachFoodStorageRuntime();
