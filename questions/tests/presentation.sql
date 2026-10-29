-- Run against the configured project. All synthetic data and broadcasts roll back.
begin;
do $$
declare
  test_id uuid := gen_random_uuid();
  result jsonb;
begin
  insert into public.question_decks(id, questions, question_meta, remaining, current, revealed)
  values(test_id, '["测试问题"]', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'created_at', now())), '{}', 0, true);
  perform set_config('request.headers', jsonb_build_object('x-question-deck', test_id)::text, true);
  result := public.update_question_settings(test_id, 0, '{"invitation":"新的封面","mode":"card"}');
  assert result ->> 'status' = 'ok', 'settings write failed';
  assert result #>> '{deck,settings,invitation}' = '新的封面', 'settings missing';
  assert result #>> '{deck,current}' = '0' and result #>> '{deck,revealed}' = 'true', 'progress changed';
  assert result #> '{deck,questions}' = '["测试问题"]'::jsonb, 'questions changed';
  result := public.update_question_settings(test_id, 0, '{"name":"过期修改"}');
  assert result ->> 'status' = 'conflict', 'stale revision accepted';
  result := public.update_question_settings(test_id, 1, '{"theme":"dark"}');
  assert result #>> '{deck,settings,mode}' = 'card', 'other setting lost';
  begin
    perform public.update_question_settings(test_id, 2, '{"theme":"invalid"}');
    raise exception 'Invalid theme accepted';
  exception when raise_exception then
    if sqlerrm <> 'Invalid theme' then raise; end if;
  end;
  begin
    perform public.update_question_settings(test_id, 2, '{"arbitrary":"value"}');
    raise exception 'Unknown field accepted';
  exception when raise_exception then
    if sqlerrm <> 'Invalid setting' then raise; end if;
  end;
  perform set_config('request.headers', '{}', true);
  assert public.update_question_settings(test_id, 2, '{"name":"无权限"}') is null, 'missing capability accepted';
  assert not has_table_privilege('anon', 'public.question_decks', 'select'), 'direct anonymous read allowed';
  assert has_function_privilege('anon', 'public.update_question_settings(uuid,bigint,jsonb)', 'execute'), 'RPC unavailable';
end;
$$;
rollback;
