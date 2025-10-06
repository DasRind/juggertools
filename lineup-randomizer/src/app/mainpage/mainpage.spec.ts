import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';

import { TeamLoaderService } from '../team-loader.service';
import { Mainpage } from './mainpage';

class TeamLoaderServiceStub {
  knownTeams: any[] = [];
  private readonly _selected = signal<string | null>(null);
  private readonly _loading = signal<string | null>(null);
  readonly selectedTeamId = this._selected.asReadonly();
  readonly loadingTeamId = this._loading.asReadonly();
  setSelectedTeam(id: string | null) {
    this._selected.set(id);
  }
  async loadTeam() {
    return Promise.resolve({ teamName: '', players: [], teamLogo: '' });
  }
  async getPreview() {
    return Promise.resolve('');
  }
}

describe('Mainpage', () => {
  let component: Mainpage;
  let fixture: ComponentFixture<Mainpage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Mainpage],
      providers: [
        provideRouter([]),
        { provide: TeamLoaderService, useClass: TeamLoaderServiceStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Mainpage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
