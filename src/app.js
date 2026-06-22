import './app-v4.js';
import { attachEcologyRuntime } from './bootstrap/attachEcologyRuntime.js';
import { attachRoadRuntime } from './bootstrap/attachRoadRuntime.js';
import { attachSeasonRuntime } from './bootstrap/attachSeasonRuntime.js';
import { attachFarmRuntime } from './bootstrap/attachFarmRuntime.js';
import { attachFarmExpansionRuntime } from './bootstrap/attachFarmExpansionRuntime.js';
import { attachFoodStorageRuntime } from './bootstrap/attachFoodStorageRuntime.js';
import { attachMapHudRuntime } from './bootstrap/attachMapHudRuntime.js';
import { attachBuildInfoRuntime } from './bootstrap/attachBuildInfoRuntime.js';

attachEcologyRuntime();
attachRoadRuntime();
attachSeasonRuntime();
attachFarmRuntime();
attachFarmExpansionRuntime();
attachFoodStorageRuntime();
attachMapHudRuntime();
attachBuildInfoRuntime();
