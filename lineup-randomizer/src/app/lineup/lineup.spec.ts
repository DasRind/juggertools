import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';

import { TeamLoaderService } from '../team-loader.service';
import { LineupComponent } from './lineup';

class TeamLoaderServiceStub {
  knownTeams: any[] = [];
  private readonly _selected = signal<string | null>(null);
  readonly selectedTeamId = this._selected.asReadonly();
  readonly loadingTeamId = signal<string | null>(null).asReadonly();
  setSelectedTeam(id: string | null) {
    this._selected.set(id);
  }
}

describe('LineupComponent', () => {
  let component: LineupComponent;
  let fixture: ComponentFixture<LineupComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LineupComponent],
      providers: [
        provideRouter([]),
        { provide: TeamLoaderService, useClass: TeamLoaderServiceStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LineupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
