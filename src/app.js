import './app-v4.js';
import { attachEcologyRuntime } from './bootstrap/attachEcologyRuntime.js';
import { attachRoadRuntime } from './bootstrap/attachRoadRuntime.js';
import { attachSeasonRuntime } from './bootstrap/attachSeasonRuntime.js';
import { attachFarmRuntime } from './bootstrap/attachFarmRuntime.js';
import { attachFarmExpansionRuntime } from './bootstrap/attachFarmExpansionRuntime.js';
import { attachFoodStorageRuntime } from './bootstrap/attachFoodStorageRuntime.js';

attachEcologyRuntime();
attachRoadRuntime();
attachSeasonRuntime();
attachFarmRuntime();
attachFarmExpansionRuntime();
attachFoodStorageRuntime();
