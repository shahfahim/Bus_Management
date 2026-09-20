/* eslint-disable */
import { BaseRepository } from './BaseRepository';

export class TripRepository extends BaseRepository<any> {
  constructor() {
    super('/trips');
  }
}

export const tripRepository = new TripRepository();
