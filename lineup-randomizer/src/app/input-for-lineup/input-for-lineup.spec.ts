import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';

import { TeamLoaderService } from '../team-loader.service';
import { InputForLineupComponent } from './input-for-lineup';

class TeamLoaderServiceStub {
  knownTeams: any[] = [];
  private readonly _selected = signal<string | null>(null);
  private readonly _loading = signal<string | null>(null);
  readonly selectedTeamId = this._selected.asReadonly();
  readonly loadingTeamId = this._loading.asReadonly();
  setSelectedTeam(id: string | null) {
    this._selected.set(id);
  }
  async loadTeam(id: string) {
    this._loading.set(id);
    this._loading.set(null);
    return Promise.resolve({ teamName: 'demo', teamLogo: '', players: [] });
  }
  async getPreview() {
    return Promise.resolve('');
  }
}

describe('InputForLineupComponent', () => {
  let component: InputForLineupComponent;
  let fixture: ComponentFixture<InputForLineupComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InputForLineupComponent],
      providers: [
        provideRouter([]),
        { provide: TeamLoaderService, useClass: TeamLoaderServiceStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InputForLineupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
