import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  type AvailabilityQuery,
  availabilityQuerySchema,
  type ResourceOut,
  type SlotAvailability,
} from './resources.dto';
import { ResourcesService } from './resources.service';

@ApiTags('resources')
@Controller('resources')
export class ResourcesController {
  constructor(private readonly resources: ResourcesService) {}

  @Get()
  @ApiOperation({ summary: 'Rooms and desk pools' })
  @ApiOkResponse({ description: 'All bookable resources.' })
  list(): Promise<ResourceOut[]> {
    return this.resources.list();
  }

  @Get(':id')
  @ApiOkResponse({ description: 'One resource.' })
  get(@Param('id') id: string): Promise<ResourceOut> {
    return this.resources.get(id);
  }

  @Get(':id/availability')
  @ApiOperation({ summary: 'Remaining capacity per slot in a window (≤ 14 days)' })
  @ApiQuery({ name: 'from', example: '2026-10-01T08:00:00Z' })
  @ApiQuery({ name: 'to', example: '2026-10-01T18:00:00Z' })
  @ApiQuery({ name: 'slot', required: false, enum: [15, 30, 60] })
  @ApiOkResponse({ description: 'Slots with capacity, booked and available counts.' })
  availability(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(availabilityQuerySchema)) query: AvailabilityQuery,
  ): Promise<SlotAvailability[]> {
    return this.resources.availability(id, query);
  }
}
