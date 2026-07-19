import type { MistakeSuggestion, SavedMistake } from '../types/mistakes'

export const suggestion = (overrides:Partial<MistakeSuggestion>={}):MistakeSuggestion=>({
  analysis_run_id:'run-1',game_id:'game-1',mistake_fingerprint:'mistake-fingerprint-1',ply:12,move_number:7,side:'white',decision_fen:'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
  played_move:'Nxe5',played_move_uci:'f3e5',best_move:'Bb5',objective_loss:1.35,cti:.88,cti_lower_bound:.84,cti_upper_bound:.91,cti_is_approximate:true,
  mbi_classification:'cognitive_trap',mbi_maia_prob:.47,system_reasons:['high_cti_mistake','human_natural_blunder'],saved:false,
  evidence:{good_moves:['Bb5'],good_moves_with_eval:{Bb5:0},best_line:['Bb5','Nf6'],stockfish_eval:.4,eval_after:-.9,mate_in:null,acceptable_drop:.5,minefield_threshold:.8,blunder_threshold:1,mbi_trap_threshold:.4,maia3_white_elo:2400,maia3_black_elo:2350,analysis_depth:14,engine:{name:'Stockfish'},maia:{model:'maia3-79m'},metric_schema_version:2},
  ...overrides,
})

export const savedMistake=(overrides:Partial<SavedMistake>={}):SavedMistake=>({
  ...suggestion(),id:'mistake-1',headers:{White:'Master',Black:'Opponent',Event:'Open'},game_created_at:'2026-01-01T00:00:00Z',note:'',tags:['Calculation horizon'],lifecycle:'active',last_practice_state:null,practice_count:0,last_practiced_at:null,attempts:[],created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',...overrides,
})
