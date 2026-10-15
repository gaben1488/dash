import importlib.util
import json
import unittest
from pathlib import Path

p=Path(__file__).with_name("release_observe.py")
spec=importlib.util.spec_from_file_location("observe",p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ObserveTests(unittest.TestCase):
 def test_private_environment_and_arguments_never_escape(self):
  v={"Name":"/PRIVATE_NAME","Image":"PRIVATE_IMAGE","Config":{"Env":["PRIVATE_KEY=PRIVATE_VALUE"],"Cmd":["PRIVATE_ARG","restore-state"]},"State":{"Status":"running","Pid":42},"Mounts":[{"Name":"aemr_server_data","Source":"PRIVATE_PATH"}]}
  out=json.dumps(m.safe_record(v));self.assertNotIn("PRIVATE",out);self.assertIn("restore-state",out)
 def test_only_readonly_docker_calls_are_used(self):
  calls=[]
  def command(args):
   calls.append(args)
   return "a"*64 if len(calls)==1 else "[]"
  self.assertEqual(m.snapshot(command),[])
  self.assertEqual(calls,[["docker","ps","--all","--quiet","--no-trunc"],["docker","inspect","a"*64]])
if __name__=="__main__":unittest.main()
