import { Module } from '@nestjs/common';
import { DataModule } from './modules/data/data.module';
import { CommunesModule } from './modules/communes/communes.module';
import { RegionsModule } from './modules/regions/regions.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { RankingsModule } from './modules/rankings/rankings.module';

@Module({
  imports: [
    DataModule,
    CommunesModule,
    RegionsModule,
    DepartmentsModule,
    RankingsModule,
  ],
})
export class AppModule {}
